"""Stage 2 — LLM side: flat LLM-facing schema, prompts, Gemini client and the
cached two-pass structured call.

The full ``DocumentExtraction`` schema (11-type discriminated union, datetimes,
cross-validators) is the STORAGE schema, not something a model can emit
directly — structured output rejects very deep/complex schemas. So the model
fills a flat schema with window-local ids (m1, m2…), split across two calls:

- pass A -> ``LLMMentionsOnly`` — the entities in the focus text, nothing else.
- pass B -> ``LLMLinksOnly`` — relations, claims, appraisals and quotation
  attributions over the numbered mention list pass A returned, fed back as
  input. Skipped outright when pass A finds fewer than two mentions.

Splitting removes the forward reference that made a single call fragile (a
quotation had to name a speaker_local_id before that mention existed in its
own output) and halves each schema — which buys room for a per-field Arabic
description on every enum. Those descriptions ship inside responseSchema, so
the model reads them while filling that very field. The two passes cache
independently, so editing one prompt re-bills only that one.
"""
import json
import logging
import os
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from . import config, io_utils
from .config import LINKS_MIN_MENTIONS, OVERSIZED_FOCUS_CAP, STAGE2_PROMPT_VERSION
from .schema import (AppraisalPolarity, AppraisalRank, AppraisalScopeKind,
                     ClaimPredicate, OrganizationSubtype, RelationType, SectKind,
                     WorkSubtype)

logger = logging.getLogger(__name__)

MENTION_LABELS = ("person", "place", "work", "tribe", "sect", "religion",
                  "dynasty", "office", "organization", "event", "time",
                  "quotation")
QUOTE_TYPES = ("quran", "hadith", "athar", "poetry", "reported_speech")
# Literal choices generated from the heritage enums so they can never drift:
RELATION_TYPE_VALUES = tuple(rt.value for rt in RelationType)
APPRAISAL_RANK_VALUES = tuple(r.value for r in AppraisalRank)
POLARITY_VALUES = tuple(p.value for p in AppraisalPolarity)
SCOPE_KIND_VALUES = tuple(k.value for k in AppraisalScopeKind)
CLAIM_PREDICATE_VALUES = tuple(p.value for p in ClaimPredicate)
# "unknown" is NOT offered to the model — absence is expressed by null only, and
# the mapping layer turns a null subtype into the enum's UNKNOWN member. Two ways
# to say "I don't know" is one way too many.
WORK_SUBTYPE_VALUES = tuple(w.value for w in WorkSubtype
                            if w is not WorkSubtype.UNKNOWN)
ORG_SUBTYPE_VALUES = tuple(o.value for o in OrganizationSubtype
                           if o is not OrganizationSubtype.UNKNOWN)
SECT_KIND_VALUES = tuple(k.value for k in SectKind if k is not SectKind.UNKNOWN)


# -----------------------------------------------------------------------------
# Pass A models — mentions only
# -----------------------------------------------------------------------------

class LLMNameComponents(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kunya: str | None = Field(None, description="الكنية: أبو فلان / أم فلان")
    ism: str | None = Field(None, description="الاسم المفرد: محمد، أحمد، علي")
    nasab: list[str] = Field(
        default_factory=list,
        description="سلسلة الآباء بترتيب ورودها، كل اسم عنصر مستقل بدون كلمة «بن»",
    )
    nisba: list[str] = Field(
        default_factory=list,
        description="النسبة إلى بلد أو قبيلة أو حرفة أو مذهب: البخاري، التميمي، الشافعي",
    )
    laqab: list[str] = Field(
        default_factory=list,
        description="اللقب الوصفي الملازم للاسم: الأعرج، الضرير. "
                    "المناصب والرتب (الحافظ، القاضي) ليست هنا — تُرصد ككيان office مستقل، "
                    "والألقاب التشريفية (الشيخ، الإمام، العلامة) لا تُرصد أصلًا",
    )
    shuhra: str | None = Field(
        None, description="ما اشتُهر به فغلب على اسمه: ابن تيمية، الخطيب البغدادي"
    )


class LLMMention(BaseModel):
    model_config = ConfigDict(extra="ignore")

    local_id: str = Field(description="معرّف متسلسل: m1، m2، m3 بترتيب الورود في النص")
    label: Literal[MENTION_LABELS] = Field(
        description="person=شخص · place=مدينة أو إقليم أو مسجد أو نهر مسمّى · "
                    "work=عنوان كتاب أو مصنّف · tribe=قبيلة · "
                    "sect=فرقة أو مذهب داخل دين · religion=دين أو ملة · "
                    "dynasty=دولة أو أسرة حاكمة · office=منصب أو لقب وظيفي · "
                    "organization=مؤسسة مسمّاة · event=واقعة مسمّاة · "
                    "time=تاريخ أو مدة · quotation=آية أو حديث أو أثر أو شعر أو قول منقول"
    )
    text: str = Field(
        description="نسخة حرفية من نص البؤرة كما ورد تمامًا — يُبحث عنها آليًا بمطابقة حرفية"
    )
    occurrence: int = Field(
        1, description="رقم التكرار المقصود إن تكرر النص نفسه داخل البؤرة، يبدأ من 1"
    )
    normalized: str | None = Field(
        None, description="الصورة المعيارية للاسم أو المصطلح إن اختلفت عن النص الوارد"
    )

    name_components: LLMNameComponents | None = Field(
        None, description="لكيانات person فقط. املأ ما يظهر في النص واترك الباقي فارغًا"
    )

    work_subtype: Literal[WORK_SUBTYPE_VALUES] | None = Field(
        None,
        description="لكيانات work فقط. book=كتاب أو مصنّف مطبوع · manuscript=مخطوط أو نسخة خطية · "
                    "journal=مجلة أو دورية · article=مقال أو بحث منشور · epistle=رسالة · "
                    "thesis=رسالة ماجستير أو دكتوراه · collection=ديوان أو مجموع · "
                    "other=وعاء آخر واضح. اتركه فارغًا إن لم يدل النص على الوعاء ولا تخمّن",
    )

    org_subtype: Literal[ORG_SUBTYPE_VALUES] | None = Field(
        None,
        description="لكيانات organization فقط. school=مدرسة أو دار حديث أو دار علم · "
                    "library=خزانة أو مكتبة · hospital=بيمارستان · bureau=ديوان أو إدارة · "
                    "endowment=وقف · university=جامعة · academy=مجمع علمي أو جمعية · "
                    "publisher=دار نشر أو مطبعة · government_body=وزارة أو محكمة أو مؤسسة "
                    "رسمية حديثة · other=نوع آخر واضح. اتركه فارغًا إن لم يدل النص",
    )

    sect_kind: Literal[SECT_KIND_VALUES] | None = Field(
        None,
        description="لكيانات sect فقط. theological=فرقة عقدية كالمعتزلة والخوارج "
                    "والأشاعرة والشيعة · legal=مذهب فقهي كالحنفية والشافعية والمالكية "
                    "والحنابلة · sufi=طريقة صوفية كالقادرية والرفاعية · other=نوع آخر واضح. "
                    "املأه من المعروف عن الفرقة نفسها لا من سياق الجملة، واتركه فارغًا إن أشكل",
    )

    hijri_year: int | None = Field(
        None, description="لكيانات time فقط. «سنة أربع ومائتين» ← 204"
    )
    hijri_year_to: int | None = Field(
        None,
        description="لكيانات time فقط. الطرف الأعلى للمدى غير الدقيق: "
                    "«بضع وأربعين ومائة» ← hijri_year=141 و hijri_year_to=149",
    )
    approximate: bool = Field(
        False, description="true مع صيغ التقريب: «نحو سنة»، «قريبًا من سنة»"
    )
    relative_anchor: str | None = Field(
        None,
        description="لكيانات time المؤرَّخة بحدث لا برقم: «في خلافة المأمون». "
                    "في هذه الحالة يبقى hijri_year فارغًا",
    )

    quote_type: Literal[QUOTE_TYPES] | None = Field(
        None, description="لكيانات quotation فقط"
    )
    sura: int | None = Field(None, description="رقم السورة، لـ quote_type=quran فقط")
    aya_start: int | None = Field(None, description="رقم أول آية، لـ quran فقط")
    aya_end: int | None = Field(
        None, description="رقم آخر آية إن كان الاقتباس أكثر من آية، لـ quran فقط"
    )


class LLMMentionsOnly(BaseModel):
    """مخرجات المرحلة الأولى."""
    model_config = ConfigDict(extra="ignore")
    mentions: list[LLMMention] = Field(default_factory=list)


# -----------------------------------------------------------------------------
# Pass B models — relations, claims, appraisals, quotation attribution
# -----------------------------------------------------------------------------

class LLMRelation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    relation_type: Literal[RELATION_TYPE_VALUES] = Field(
        description="نوع العلاقة من القائمة المغلقة"
    )
    subject_local_id: str = Field(description="معرّف الكيان الفاعل من قائمة الكيانات")
    object_local_id: str = Field(description="معرّف الكيان المفعول به من قائمة الكيانات")
    place_local_id: str | None = Field(
        None, description="مكان وقوع العلاقة إن ذُكر صراحة"
    )
    time_local_id: str | None = Field(
        None, description="زمن وقوع العلاقة إن ذُكر صراحة"
    )
    trigger: str | None = Field(
        None,
        description="اللفظ الذي دلّ على العلاقة، منسوخًا من النص: "
                    "حدثنا، تفقه على، ولي، صنّف، نشرته",
    )


class LLMClaim(BaseModel):
    model_config = ConfigDict(extra="ignore")

    predicate: Literal[CLAIM_PREDICATE_VALUES] = Field(
        description="نوع الادعاء الزمني: ميلاد، وفاة، مدة حياة"
    )
    subject_local_id: str = Field(description="معرّف الشخص المعنيّ")
    time_local_id: str = Field(description="معرّف كيان من نوع time")


class LLMAppraisal(BaseModel):
    model_config = ConfigDict(extra="ignore")

    critic_local_id: str = Field(description="معرّف قائل الحكم")
    subject_local_id: str = Field(description="معرّف المحكوم عليه")
    verbatim: str = Field(
        description="نص الحكم منسوخًا حرفيًا: «ثقة ثبت»، «ليس بشيء»، «صدوق يهم»"
    )
    polarity: Literal[POLARITY_VALUES] = Field(
        description="tadil=تعديل · jarh=جرح · mixed=فيه تعديل وجرح معًا · "
                    "neutral=وصف لا حكم"
    )
    rank: Literal[APPRAISAL_RANK_VALUES] | None = Field(
        None,
        description="المرتبة على سلّم ابن حجر. املأه فقط إن طابق نص الحكم "
                    "أحد ألفاظ المراتب المعروفة؛ وإلا اتركه فارغًا ولا تجتهد",
    )
    scope_kind: Literal[SCOPE_KIND_VALUES] = Field(
        "general",
        description="general=حكم مطلق · in_shaykh=مقيّد بالرواية عن شيخ بعينه · "
                    "in_work=مقيّد بكتاب · in_period=مقيّد بفترة · in_topic=مقيّد بباب",
    )
    scope_target_local_id: str | None = Field(
        None, description="معرّف الكيان الذي قُيّد به الحكم، إن كان scope_kind ليس general"
    )


class LLMQuoteAttribution(BaseModel):
    """إسناد الاقتباس إلى قائله والمقول فيه.

    Not a relation: RelationType is a closed enum over KB-level entity types,
    and ``quotation`` deliberately has no entity counterpart (EntityType omits
    it), so said_by/about have no home there. QuotationMention carries the two
    ids as fields instead, and this list fills them — from pass B, where the
    mention list already exists, rather than from a forward reference inside
    pass A.
    """
    model_config = ConfigDict(extra="ignore")

    quote_local_id: str = Field(description="معرّف كيان من نوع quotation")
    speaker_local_id: str | None = Field(None, description="معرّف قائل الاقتباس")
    about_local_id: str | None = Field(None, description="معرّف المقول فيه")


class LLMLinksOnly(BaseModel):
    """مخرجات المرحلة الثانية."""
    model_config = ConfigDict(extra="ignore")
    relations: list[LLMRelation] = Field(default_factory=list)
    claims: list[LLMClaim] = Field(default_factory=list)
    appraisals: list[LLMAppraisal] = Field(default_factory=list)
    quote_attributions: list[LLMQuoteAttribution] = Field(default_factory=list)


class LLMWindowExtraction(BaseModel):
    """The two passes joined back together — what map_window() consumes.
    Never sent to the model; only LLMMentionsOnly and LLMLinksOnly are."""
    model_config = ConfigDict(extra="ignore")
    mentions: list[LLMMention] = Field(default_factory=list)
    relations: list[LLMRelation] = Field(default_factory=list)
    claims: list[LLMClaim] = Field(default_factory=list)
    appraisals: list[LLMAppraisal] = Field(default_factory=list)
    quote_attributions: list[LLMQuoteAttribution] = Field(default_factory=list)


# =============================================================================
# Pass A prompt — mentions
# =============================================================================

MENTIONS_INSTRUCTIONS = """[المهمة]
أنت خبير في تحليل نصوص التراث العربي (تراجم، حديث، تاريخ، فقه).
استخرج الكيانات المذكورة في نص "البؤرة" وحده. النصان المحيطان للفهم فقط.

وصف كل نوع وكل حقل موجود في المخطط المرفق. ما يلي قواعد الفصل بين
الأنواع المتشابهة، وهي المواضع التي يقع فيها الخطأ عادة.

[حدود الأنواع]
- مدى اسم الشخص أقصى ما يتصل به: الكنية والنسب والنسبة معًا.
  وما يسبق الاسم من ألقاب فخارج مداه، وهو صنفان:
  · المنصب أو الرتبة — القاضي، الوزير، المحتسب، الخطيب، الحافظ،
    شيخ الإسلام، قاضي القضاة — يُرصد كيانًا مستقلًا من نوع office.
  · اللقب التشريفي المجرّد — الشيخ، الإمام، العلامة، الفقيه، الأستاذ،
    الحجة، سيدنا — لا يُرصد أصلًا، لا كيانًا ولا جزءًا من الاسم.
  فإن أضاف النص اللقب التشريفي إلى ولاية أو جهة — إمام الحرم،
  شيخ الشيوخ، ولي الإمامة بجامع كذا — صار منصبًا فيُرصد office.
- المسجد والجامع والسوق والرباط والمحلة: place لا organization.
- المدرسة ودار الحديث والخزانة والبيمارستان والديوان والوقف: organization.
- الدولة والأسرة الحاكمة: dynasty.
- الفرقة والمذهب داخل الدين — المعتزلة، الخوارج، الشافعية،
  أهل السنة، الشيعة، القادرية، الأرثوذكس — sect.
- الدين والملة نفسها — الإسلام، النصرانية، اليهودية، المجوسية،
  الصابئة، الهندوسية، البوذية — religion، ومثلها أتباعها بلفظ
  الجماعة (اليهود، النصارى، المجوس) فالمقصود ملتهم.
- لا ترصد religion إلا حيث نسبها النص إلى شخص أو فرقة أو كتاب:
  اعتناقًا (أسلم، تنصّر، ارتدّ)، أو انتسابًا (كان نصرانيًا، على دين المجوس)،
  أو ردًّا (ردّ على اليهود)، أو انتماء فرقة إليها (المعتزلة من فرق الإسلام).
  أما اللفظ المرسل — «شيخ الإسلام»، «في صدر الإسلام»، «دار الإسلام»،
  «الحمد لله على الإسلام» — فلا يرصد، و«شيخ الإسلام» office لأنه رتبة
  لا لقب تشريفي مجرّد.
- فعل الاعتناق وحده — أسلم، تنصّر، تهوّد، تمجّس — يرصد religion
  نصّه الفعل منسوخًا كما ورد، و normalized اسم الدين (أسلم ← الإسلام)،
  لأنه اللفظ الوحيد الدالّ عليه في النص. وهذه وحدها الحالة التي
  يكون فيها نص الكيان فعلاً لا اسمًا.
- المنصب المجرّد office، والجهة المسمّاة organization:
  «ولي الوزارة» ← office، و«وزارة الأوقاف» ← organization.

[أمثلة محلولة]

مثال ١ — الرتبة تُرصد office واللقب التشريفي يُهمل:
النص: «قال الشيخ الإمام الحافظ أبو بكر أحمد بن علي الخطيب البغدادي»
m1  person  "أبو بكر أحمد بن علي الخطيب البغدادي"
        kunya="أبو بكر"، ism="أحمد"، nasab=["علي"]،
        nisba=["البغدادي"]، shuhra="الخطيب البغدادي"
m2  office  "الحافظ"

لاحظ أن «الشيخ» و«الإمام» لم يُرصدا: لقبان تشريفيان لا منصب فيهما،
وليسا من مدى الاسم.

مثال ٢ — مؤسسة ومكان في سياق واحد:
النص: «درّس بالمدرسة النظامية ببغداد ثم صلى بجامع المنصور»
m1  organization  "المدرسة النظامية"   org_subtype="school"
m2  place         "بغداد"
m3  place         "جامع المنصور"

مثال ٣ — تاريخ نسبي وتاريخ صريح:
النص: «ولد نحو سنة عشرين ومائتين، وتوفي في خلافة المعتضد»
m1  time  "نحو سنة عشرين ومائتين"   hijri_year=220، approximate=true
m2  time  "في خلافة المعتضد"        relative_anchor="خلافة المعتضد"

مثال ٤ — كتاب لم يدل النص على وعائه:
النص: «وله كتاب العلل، وقد نُشر بحث عنه في مجلة المجمع»
m1  work  "كتاب العلل"      work_subtype=null
m2  work  "مجلة المجمع"     work_subtype="journal"

لاحظ في المثال الرابع أن «كتاب العلل» تُرك فارغًا رغم كلمة «كتاب»،
لأن النص لم يبيّن أهو مطبوع أم مخطوط. الفراغ أصح من التخمين.

مثال ٥ — دين منسوب ولفظ مرسل:
النص: «كان أبوه نصرانيًا ثم أسلم، وهو شيخ الإسلام في زمانه»
m1  person    "أبوه"
m2  religion  "نصرانيًا"   normalized="النصرانية"
m3  religion  "أسلم"        normalized="الإسلام"
m4  office    "شيخ الإسلام"

مثال ٦ — فرقة ودين في سياق واحد:
النص: «والمعتزلة فرقة من فرق الإسلام، وله ردّ على اليهود»
m1  sect      "المعتزلة"   sect_kind="theological"
m2  religion  "الإسلام"
m3  religion  "اليهود"     normalized="اليهودية"

لاحظ أن «الإسلام» في المثال السادس رُصدت لأن النص نسب إليها فرقة،
وفي المثال الخامس لم تُرصد من «شيخ الإسلام» لأنها جزء من لقب.

[قواعد صارمة]
- انسخ حقل text حرفيًا كما ورد في البؤرة — سيُبحث عنه بمطابقة حرفية،
  فأي تعديل يُسقط الكيان.
- إن تكرر النص نفسه داخل البؤرة فحدّد occurrence.
- لا تستخرج شيئًا يقع خارج البؤرة.
- local_id متسلسل من m1 بترتيب الورود.
- إن خلت البؤرة من الكيانات فأعد قائمة فارغة."""


# =============================================================================
# Pass B prompt — relations, claims, appraisals, quotation attribution
# =============================================================================

LINKS_INSTRUCTIONS = """[المهمة]
أمامك نص البؤرة، وقائمة الكيانات المستخرجة منه بمعرّفاتها.
استخرج الروابط بين هذه الكيانات وحدها.

لا تضف كيانًا جديدًا ولا تشر إلى معرّف غير موجود في القائمة.
إن لزمك كيان لم يُرصد، أهمل الرابط.

[العلاقات — أمثلة المشغّلات]
narrated_from: حدثنا، أخبرنا، سمعت، عن
student_of: تفقه على، لازم، أخذ عن، قرأ على
held_office: ولي، استُقضي، تولى
authored: صنّف، ألّف، له كتاب
died_in / born_in / resided_in / traveled_to / buried_in: للأماكن
son_of: من سلسلة النسب
member_of_tribe: من قبيلة كذا
follows_madhhab / member_of_sect: على مذهب كذا، من المعتزلة (شخص ← فرقة)

للأديان:
converted_to: أسلم، دخل في الإسلام، تنصّر، تهوّد، ارتدّ (شخص ← دين)
follows_religion: كان نصرانيًا، على دين المجوس (شخص ← دين، دون انتقال)
sect_of: فرقة من فرق كذا، من مذاهب أهل كذا (فرقة ← دين)
refuted: ردّ على، نقض على (شخص أو كتاب ← شخص أو كتاب أو فرقة أو دين)

للمؤسسات:
founded: أنشأ، بنى، أوقف، أسّس
taught_at: درّس بها، ولي التدريس بها
studied_at: قرأ بها، تفقه بها، تعلّم بها
affiliated_with: انتسب إليها، عمل فيها
published_by: نشرته أو طبعته دار كذا (كتاب ← مؤسسة)
located_in: مقر المؤسسة (مؤسسة ← مكان)
part_of: التبعية بين مكانين أو بين مؤسستين — لا لموقع المؤسسة

ضع اللفظ المشغّل في trigger منسوخًا من النص.

[إسناد الاقتباسات]
قائل الاقتباس والمقول فيه ليسا علاقتين، بل يوضعان في quote_attributions:
quote_local_id معرّف كيان من نوع quotation، وspeaker_local_id قائله،
وabout_local_id المقول فيه. اترك ما لم يدل عليه النص فارغًا.

[أمثلة محلولة]

مثال ١ — سند وحكم:
النص: «حدثنا يحيى بن معين عن هشام بن عروة، وقال يحيى: هشام ثقة»
الكيانات: m1 person "يحيى بن معين" · m2 person "هشام بن عروة"
relation:  narrated_from  subject=m1  object=m2  trigger="حدثنا ... عن"
appraisal: critic=m1  subject=m2  verbatim="ثقة"
           polarity="tadil"  scope_kind="general"

مثال ٢ — حكم مقيّد:
النص: «قال أحمد: هو ثقة إلا في روايته عن قتادة»
الكيانات: m1 person "أحمد" · m2 person "هو" · m3 person "قتادة"
appraisal: critic=m1  subject=m2  verbatim="ثقة إلا في روايته عن قتادة"
           polarity="mixed"  scope_kind="in_shaykh"  scope_target=m3

لاحظ أن polarity هنا mixed لا tadil، لأن الحكم فيه تعديل مقيّد باستثناء.

مثال ٣ — ادعاء زمني:
النص: «توفي ببغداد سنة إحدى وستين ومائتين»
الكيانات: m1 person "..." · m2 place "بغداد" · m3 time "سنة إحدى وستين ومائتين"
relation: died_in  subject=m1  object=m2  time_local_id=m3
claim:    predicate="death_date"  subject=m1  time=m3

مثال ٤ — إسناد اقتباس:
النص: «قال الشافعي: مالك حجة الله على خلقه»
الكيانات: m1 person "الشافعي" · m2 person "مالك"
          m3 quotation "مالك حجة الله على خلقه"
quote_attribution: quote=m3  speaker=m1  about=m2

مثال ٥ — دين معتنَق وردّ على فرقة:
النص: «كان مجوسيًا فأسلم، وصنّف كتابًا في الردّ على المعتزلة»
الكيانات: m1 person "..." · m2 religion "مجوسيًا" · m3 religion "أسلم"
          m4 work "كتابًا" · m5 sect "المعتزلة"
relation: follows_religion  subject=m1  object=m2  trigger="كان مجوسيًا"
relation: converted_to      subject=m1  object=m3  trigger="فأسلم"
relation: authored          subject=m1  object=m4  trigger="صنّف"
relation: refuted           subject=m4  object=m5  trigger="الردّ على"

[قواعد صارمة]
- لا تستنتج علاقة غير منصوص عليها في البؤرة. الاحتمال ليس نصًّا.
- كل معرّف تشير إليه يجب أن يكون في القائمة المرفقة.
- إن خلت البؤرة من نوع ما فأعد قائمة فارغة."""


# =============================================================================
# Prompt builders
# =============================================================================

def window_focus(norm_text: str, w) -> tuple[str, int]:
    """The focus text as it will actually be sent, plus how many characters were
    cut to respect OVERSIZED_FOCUS_CAP. The cut lands on the last sentence
    boundary instead of mid-word, as long as that keeps at least half the cap."""
    focus = norm_text[w.focus_span.start : w.focus_span.end]
    if len(focus) <= OVERSIZED_FOCUS_CAP:
        return focus, 0
    cut = focus[:OVERSIZED_FOCUS_CAP]
    boundary = max(cut.rfind("."), cut.rfind("۔"), cut.rfind("\n"))
    if boundary > OVERSIZED_FOCUS_CAP // 2:
        cut = cut[: boundary + 1]
    return cut, len(focus) - len(cut)


def build_mentions_prompt(norm_text: str, w) -> tuple[str, str, int]:
    """Pass A prompt -> (prompt, focus_as_sent, chars_dropped).

    The focus text is returned rather than recomputed by the caller: pass B must
    see byte-identical focus text, otherwise its local_ids describe a document
    the model never read."""
    fs, fe = w.focus_span.start, w.focus_span.end
    cs, ce = w.context_span.start, w.context_span.end
    focus, dropped = window_focus(norm_text, w)
    prompt = (MENTIONS_INSTRUCTIONS
              + "\n\n[سياق سابق — للفهم فقط]\n" + norm_text[cs:fs]
              + "\n[البؤرة — استخرج من هنا فقط]\n" + focus
              + "\n[سياق لاحق — للفهم فقط]\n" + norm_text[fe:ce])
    return prompt, focus, dropped


def build_links_prompt(focus_text: str, mentions: list[LLMMention]) -> str:
    """Pass B prompt — the same focus text, plus pass A's numbered mention list."""
    lines = []
    for m in mentions:
        extra = ""
        if m.label == "time" and m.hijri_year:
            extra = f"  (سنة {m.hijri_year})"
        elif m.label == "quotation" and m.quote_type:
            extra = f"  ({m.quote_type})"
        lines.append(f"{m.local_id}  {m.label}  «{m.text}»{extra}")

    return (LINKS_INSTRUCTIONS
            + "\n\n[البؤرة]\n" + focus_text
            + "\n\n[الكيانات المستخرجة]\n" + "\n".join(lines))


# =============================================================================
# Gemini client + cached two-pass structured call
# =============================================================================

def _inline_refs(schema: dict) -> dict:
    """Inline $defs/$ref (our schema is non-recursive) — defensive against
    'very large or deeply nested schemas may be rejected'."""
    defs = dict(schema.get("$defs", {}))

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node:
                ref = node["$ref"].split("/")[-1]
                merged = dict(defs.get(ref, {}))
                merged.update({k: v for k, v in node.items() if k != "$ref"})
                return walk(merged)
            return {k: walk(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk({k: v for k, v in schema.items() if k != "$defs"})


# One schema per pass — each is smaller than a joint schema would be, which is
# what buys room for the per-field Arabic descriptions.
MENTIONS_SCHEMA_JSON = _inline_refs(LLMMentionsOnly.model_json_schema())
LINKS_SCHEMA_JSON = _inline_refs(LLMLinksOnly.model_json_schema())
assert "$ref" not in json.dumps(MENTIONS_SCHEMA_JSON)
assert "$ref" not in json.dumps(LINKS_SCHEMA_JSON)

# Cache tags carry the prompt version: editing a prompt invalidates its cache
# without colliding with earlier entries still on disk.
EXTRACT_TAG_MENTIONS = f"{STAGE2_PROMPT_VERSION}-mentions"
EXTRACT_TAG_LINKS = f"{STAGE2_PROMPT_VERSION}-links"

_gemini = None            # (client, use_interactions) once initialized


def get_gemini_client():
    """Lazy singleton -> (client, use_interactions). Which Google endpoint the
    key belongs to: AI Studio keys ("AIza...") speak the Gemini Developer API;
    Vertex AI / Google Cloud keys speak Vertex AI. Sending one to the other's
    endpoint returns 403 PERMISSION_DENIED. KB_GEMINI_USE_VERTEX forces it;
    unset = auto-detect from the key prefix. The Interactions API only exists
    on the Developer API — Vertex express mode 404s there, so we fall back to
    generateContent (same model, same JSON schema)."""
    global _gemini
    if _gemini is None:
        from google import genai

        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        use_vertex = config.gemini_use_vertex()
        if use_vertex is None:
            use_vertex = not api_key.startswith("AIza")
        if use_vertex:
            # Express-mode Vertex keys are project-less; stray GOOGLE_CLOUD_*
            # vars would push the SDK onto project-scoped paths the key cannot
            # authenticate against.
            for v in ("GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"):
                os.environ.pop(v, None)
        client = genai.Client(vertexai=use_vertex, api_key=api_key)
        use_interactions = hasattr(client, "interactions") and not use_vertex
        _gemini = (client, use_interactions)
        logger.info("Gemini client ready — model %s, api %s (vertexai=%s)",
                    config.extract_model(),
                    "interactions" if use_interactions else "generate_content",
                    use_vertex)
    return _gemini


def _gemini_call(prompt: str, schema: dict) -> str:
    client, use_interactions = get_gemini_client()
    if use_interactions:
        inter = client.interactions.create(
            model=config.extract_model(),
            input=prompt,
            response_format={"type": "text", "mime_type": "application/json",
                             "schema": schema},
            generation_config={"thinking_level": config.thinking_level()},
        )
        return inter.output_text or ""
    resp = client.models.generate_content(
        model=config.extract_model(), contents=prompt,
        config={"response_mime_type": "application/json",
                "response_schema": schema,
                "thinking_config": {"thinking_level": config.thinking_level()}},
    )
    return resp.text or ""


def _cached_structured(book_id: str, tag: str, prompt: str, schema: dict,
                       model_cls, what: str):
    """One cached, retried, self-repairing structured call.

    The raw response text is cached BEFORE parsing, so a validation failure
    never costs a second billed call for the same prompt; the repair round-trip
    is cached under its own key."""
    model = config.extract_model()
    key = io_utils.cache_key(model, tag, prompt)
    cached = io_utils.cache_get("extract", book_id, key)
    if cached is None:
        text = io_utils.with_retries(lambda: _gemini_call(prompt, schema), what=what)
        cached = {"response_text": text}
        io_utils.cache_put("extract", book_id, key, cached)
    try:
        return model_cls.model_validate(
            io_utils.parse_json_lenient(cached["response_text"]))
    except (ValueError, ValidationError) as e:
        repair = (prompt + "\n\nYour previous reply failed validation: "
                  + str(e)[:500]
                  + "\nReply again with ONLY a valid JSON object matching the schema.")
        rkey = io_utils.cache_key(model, tag + "-repair", repair)
        rcached = io_utils.cache_get("extract", book_id, rkey)
        if rcached is None:
            text = io_utils.with_retries(lambda: _gemini_call(repair, schema),
                                         what=what + " repair")
            rcached = {"response_text": text}
            io_utils.cache_put("extract", book_id, rkey, rcached)
        return model_cls.model_validate(
            io_utils.parse_json_lenient(rcached["response_text"]))


def call_extract_llm(book_id: str, window_idx: int, mentions_prompt: str,
                     focus_text: str) -> LLMWindowExtraction:
    """Both passes for one window, joined. Pass A is cached independently of
    pass B, so a re-run after editing only LINKS_INSTRUCTIONS re-bills half."""
    what = f"extract {book_id[:30]} w{window_idx}"
    men = _cached_structured(book_id, EXTRACT_TAG_MENTIONS, mentions_prompt,
                             MENTIONS_SCHEMA_JSON, LLMMentionsOnly, what + " A")
    if len(men.mentions) < LINKS_MIN_MENTIONS:
        return LLMWindowExtraction(mentions=men.mentions)
    links = _cached_structured(book_id, EXTRACT_TAG_LINKS,
                               build_links_prompt(focus_text, men.mentions),
                               LINKS_SCHEMA_JSON, LLMLinksOnly, what + " B")
    return LLMWindowExtraction(
        mentions=men.mentions, relations=links.relations, claims=links.claims,
        appraisals=links.appraisals, quote_attributions=links.quote_attributions)


@dataclass
class WindowCallStatus:
    """What the two passes for one window would cost — computed from disk only,
    zero API calls. Pass B's prompt is derived from pass A's answer, so until A
    is cached B is unknowable and counted as billable."""
    mentions_prompt: str
    focus: str
    focus_dropped: int
    mentions_cached: bool
    n_mentions: int | None          # None while pass A is uncached
    links_prompt: str | None        # None while pass A is uncached
    links_state: str                # cached | pending | skipped | unknown

    @property
    def to_bill(self) -> int:
        return ((0 if self.mentions_cached else 1)
                + (0 if self.links_state in ("cached", "skipped") else 1))

    @property
    def free(self) -> bool:
        return self.to_bill == 0


def window_call_status(book_id: str, norm_text: str, w) -> WindowCallStatus:
    """Same cache keys the run computes, so ``free`` here means that window
    replays at zero cost. Reads the cache without mutating it."""
    model = config.extract_model()
    prompt, focus, dropped = build_mentions_prompt(norm_text, w)
    raw = io_utils.read_json_or_none(
        io_utils.cache_path("extract", book_id,
                            io_utils.cache_key(model, EXTRACT_TAG_MENTIONS, prompt)))
    if raw is None:
        return WindowCallStatus(prompt, focus, dropped, False, None, None, "unknown")
    try:
        mentions = LLMMentionsOnly.model_validate(
            io_utils.parse_json_lenient(raw["response_text"])).mentions
    except (ValueError, KeyError, ValidationError):
        # cached but unparseable — the run will spend a repair call, then pass B
        return WindowCallStatus(prompt, focus, dropped, True, None, None, "unknown")
    if len(mentions) < LINKS_MIN_MENTIONS:
        return WindowCallStatus(prompt, focus, dropped, True, len(mentions),
                                None, "skipped")
    lprompt = build_links_prompt(focus, mentions)
    hit = io_utils.cache_path(
        "extract", book_id,
        io_utils.cache_key(model, EXTRACT_TAG_LINKS, lprompt)).exists()
    return WindowCallStatus(prompt, focus, dropped, True, len(mentions), lprompt,
                            "cached" if hit else "pending")
