"""Pydantic v2 schema for NER + knowledge-base extraction from classical Arabic texts.

Layers
------
1. Mention layer   : spans found in text (NER output), possibly noisy (OCR).
2. Entity layer    : canonical KB nodes that mentions link to.
3. Assertion layer : Relations (entity <-> entity) and Claims (entity -> literal
                     value, e.g. death dates). Both are multi-source and are
                     NEVER overwritten -- conflicting sources coexist, each with
                     its own provenance, and resolution happens at query time.

Core design decisions (agreed during planning)
----------------------------------------------
- Type vs. role: PERSON is the only human entity type. "Author", "narrator",
  "judge" are roles expressed through relations (AUTHORED, NARRATED_FROM,
  HELD_OFFICE), never entity types.
- Maximal spans: NER tags the full name span; decomposition into
  kunya/ism/nasab/nisba is a separate analysis layer (NameComponents).
- Titles preceding a name are OUTSIDE the person span. Offices and ranks
  (القاضي، الوزير، الحافظ، شيخ الإسلام) are OFFICE mentions linked to the
  person via HELD_OFFICE; bare honorifics (الشيخ، الإمام، العلامة) are not
  extracted at all -- they carry no KB content.
- Dates are Claims, not fixed fields, because sources contradict each other.
- Quotations (آية/حديث/أثر/شعر) are mention-level objects with canonical
  references and match scores -- they are not KB entities.
- NIL handling: a mention may link to no entity (LinkingStatus) and later
  spawn a new one.
- Every assertion carries provenance (book, page, span, extractor, method).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = "1.0"

# ---------------------------------------------------------------------------
# Shared scalar types
# ---------------------------------------------------------------------------

Confidence = Annotated[float, Field(ge=0.0, le=1.0)]
EntityId = Annotated[str, Field(min_length=1)]


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class StrictModel(BaseModel):
    """Base for all schema models: forbid typos, strip whitespace,
    re-validate on assignment."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        validate_assignment=True,
    )


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class EntityType(str, Enum):
    """KB-level entity types. TIME and QUOTATION are deliberately absent:
    they live at the mention layer only."""

    PERSON = "person"        # شخص
    PLACE = "place"          # مكان
    WORK = "work"            # مؤلَّف
    TRIBE = "tribe"          # قبيلة
    SECT = "sect"            # فرقة / مذهب
    RELIGION = "religion"    # دين / ملة (الإسلام، النصرانية، المجوسية، الهندوسية)
    DYNASTY = "dynasty"      # دولة / أسرة حاكمة
    OFFICE = "office"        # منصب أو رتبة (قضاء، وزارة، حسبة، الحافظ) — لا الألقاب التشريفية (الشيخ، الإمام)
    ORGANIZATION = "organization"  # مؤسسة/هيئة (مدرسة، ديوان، وقف، دار نشر، جامعة)
    EVENT = "event"          # حدث مسمّى (بدر، صفين) — نطاق المستوى الثالث


class PlaceSubtype(str, Enum):
    SETTLEMENT = "settlement"            # مدينة / قرية
    REGION = "region"                    # إقليم / كورة
    FACILITY = "facility"                # مسجد / سوق / مدرسة مسمّاة
    NATURAL_FEATURE = "natural_feature"  # نهر / جبل / وادٍ


class WorkSubtype(str, Enum):
    """وعاء المؤلَّف لا نوعه التأليفي: كتاب مطبوع أم مخطوط أم مقال في دورية...
    (الفنّ/الموضوع في Work.discipline، والشرح/المختصر/الذيل في RelationType)."""

    BOOK = "book"              # كتاب / مصنَّف مطبوع
    MANUSCRIPT = "manuscript"  # مخطوط
    JOURNAL = "journal"        # مجلة / دورية
    ARTICLE = "article"        # مقال / بحث منشور
    EPISTLE = "epistle"        # رسالة
    THESIS = "thesis"          # رسالة علمية (ماجستير/دكتوراه)
    COLLECTION = "collection"  # ديوان / مجموع
    OTHER = "other"            # نوع معروف لا يندرج تحت ما سبق
    UNKNOWN = "unknown"        # غير محدد في النص


class OrganizationSubtype(str, Enum):
    """نوع المؤسسة. المؤسسة هيئة لها أعضاء وتُدير وتُعيّن وتَقف وتَنشر --
    وهذا ما يفرقها عن `place`: المسجد والسوق والرباط أماكن (facility)،
    والمدرسة والديوان والوقف ودار النشر مؤسسات. والفرق عن `dynasty`:
    الدولة/الأسرة الحاكمة تبقى dynasty، وعن `office`: المنصب وظيفة لا هيئة."""

    SCHOOL = "school"                    # مدرسة / دار حديث / دار علم / كُتّاب
    LIBRARY = "library"                  # خزانة كتب / دار الكتب / مكتبة
    HOSPITAL = "hospital"                # بيمارستان / مستشفى
    BUREAU = "bureau"                    # ديوان (الإنشاء، الخراج، الجند) / إدارة
    ENDOWMENT = "endowment"              # وقف / أوقاف
    UNIVERSITY = "university"            # جامعة (حديثة)
    ACADEMY = "academy"                  # مجمع علمي / جمعية / هيئة علمية
    PUBLISHER = "publisher"              # دار نشر / مطبعة / مكتب نشر
    GOVERNMENT_BODY = "government_body"  # وزارة / محكمة / مؤسسة رسمية
    OTHER = "other"                      # نوع معروف لا يندرج تحت ما سبق
    UNKNOWN = "unknown"                  # غير محدد في النص


class SectKind(str, Enum):
    """الفرقة والمذهب داخل دين واحد. الدين نفسه (`religion`) ليس منها:
    المعتزلة والشافعية فرق ومذاهب في الإسلام، والإسلام دين."""

    THEOLOGICAL = "theological"  # فرقة عقدية (معتزلة، خوارج)
    LEGAL = "legal"              # مذهب فقهي (حنفية، شافعية)
    SUFI = "sufi"                # طريقة صوفية
    OTHER = "other"              # نوع معروف لا يندرج تحت ما سبق
    UNKNOWN = "unknown"          # غير محدد في النص


class QuotationType(str, Enum):
    QURAN = "quran"                      # آية
    HADITH = "hadith"                    # حديث نبوي
    ATHAR = "athar"                      # أثر / قول صحابي أو تابعي
    POETRY = "poetry"                    # شعر
    REPORTED_SPEECH = "reported_speech"  # قول منقول عام


class ExtractionMethod(str, Enum):
    RULE = "rule"            # صيغ التحديث والقوالب
    GAZETTEER = "gazetteer"  # مطابقة معجمية
    MODEL = "model"          # موديل مدرَّب (CAMeLBERT-CA)
    LLM = "llm"              # أنوتيشن silver
    HUMAN = "human"          # مراجعة بشرية / gold


class LinkingStatus(str, Enum):
    LINKED = "linked"          # مربوط بكيان موجود
    NIL_NEW = "nil_new"        # شخص/كيان جديد غير موجود في القاعدة
    AMBIGUOUS = "ambiguous"    # مرشحون متعددون بلا حسم
    UNLINKED = "unlinked"      # لم يمر بمرحلة الربط بعد


class AssertionStatus(str, Enum):
    ASSERTED = "asserted"    # كما ورد، بلا مراجعة
    PREFERRED = "preferred"  # الرواية المرجَّحة عند التعارض
    DISPUTED = "disputed"    # متعارض مع ادعاءات أخرى
    REJECTED = "rejected"    # مرفوض بعد المراجعة


class MatchMethod(str, Enum):
    EXACT = "exact"          # مطابقة حرفية بعد التطبيع (القرآن غالبًا)
    FUZZY = "fuzzy"          # مطابقة تقريبية (الحديث المروي بالمعنى)
    EMBEDDING = "embedding"  # استرجاع دلالي


class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"
    UNKNOWN = "unknown"


class AppraisalPolarity(str, Enum):
    """اتجاه الحكم في أقوال العلماء."""

    TADIL = "tadil"      # تعديل
    JARH = "jarh"        # جرح
    MIXED = "mixed"      # مختلف فيه، أو مقيَّد: "ثقة إلا في روايته عن فلان"
    NEUTRAL = "neutral"  # وصف أو ثناء عام بلا حكم اصطلاحي


class AppraisalRank(str, Enum):
    """مراتب الجرح والتعديل على سُلَّم ابن حجر (١٢ مرتبة).

    التصنيف اجتهادي ومختلَف فيه بين المدارس -- ولهذا يبقى النص الحرفي
    (`verbatim`) هو المرجع، وهذا الحقل اختياري وقابل لإعادة الحساب."""

    AWTHAQ_AL_NAS = "awthaq_al_nas"                # أوثق الناس / إليه المنتهى
    THIQA_THIQA = "thiqa_thiqa"                    # ثقة ثقة / ثبت ثبت
    THIQA = "thiqa"                                # ثقة / حجة / ثبت
    SADUQ = "saduq"                                # صدوق / لا بأس به
    SADUQ_SAYYI_AL_HIFZ = "saduq_sayyi_al_hifz"    # صدوق سيئ الحفظ / يهم
    MAQBUL = "maqbul"                              # مقبول عند المتابعة
    LAYYIN = "layyin"                              # لين الحديث / فيه مقال
    DAIF = "daif"                                  # ضعيف / ليس بالقوي
    MUNKAR_AL_HADITH = "munkar_al_hadith"          # منكر الحديث / واهٍ
    MATRUK = "matruk"                              # متروك / ساقط
    MUTTAHAM_BIL_KADHIB = "muttaham_bil_kadhib"    # متهم بالكذب
    KADHDHAB = "kadhdhab"                          # كذاب / وضّاع


APPRAISAL_RANK_LEVEL: dict[AppraisalRank, int] = {
    AppraisalRank.AWTHAQ_AL_NAS: 1,
    AppraisalRank.THIQA_THIQA: 2,
    AppraisalRank.THIQA: 3,
    AppraisalRank.SADUQ: 4,
    AppraisalRank.SADUQ_SAYYI_AL_HIFZ: 5,
    AppraisalRank.MAQBUL: 6,
    AppraisalRank.LAYYIN: 7,
    AppraisalRank.DAIF: 8,
    AppraisalRank.MUNKAR_AL_HADITH: 9,
    AppraisalRank.MATRUK: 10,
    AppraisalRank.MUTTAHAM_BIL_KADHIB: 11,
    AppraisalRank.KADHDHAB: 12,
}
"""1 = أعلى تعديل، 12 = أشد جرح. مراتب 1-6 تعديل و7-12 جرح."""

TADIL_MAX_LEVEL = 6


class AppraisalScopeKind(str, Enum):
    """نطاق الحكم -- تجاهله يقلب المعنى تمامًا.
    'ثقة إلا في روايته عن قتادة' ليست 'ثقة'."""

    GENERAL = "general"        # حكم مطلق
    IN_SHAYKH = "in_shaykh"    # مقيَّد بالرواية عن شيخ بعينه
    IN_WORK = "in_work"        # مقيَّد بكتاب بعينه
    IN_PERIOD = "in_period"    # مقيَّد بمرحلة (قبل الاختلاط / بعده)
    IN_TOPIC = "in_topic"      # مقيَّد بباب أو فن


class TextStream(str, Enum):
    """المجرى النصي. الفصل بين المتن والحاشية يسبق أي تقطيع بنيوي:
    الحاشية نص المحقق المعاصر، وخلطها بالمتن يلوّث كل شيء."""

    MAIN = "main"                  # المتن
    FOOTNOTE = "footnote"          # حاشية المحقق
    HEADER = "header"              # ترويسة/تذييل الصفحة
    FRONT_MATTER = "front_matter"  # مقدمة المحقق والدراسة
    INDEX = "index"                # الفهارس


class SegmentType(str, Enum):
    """أنواع الوحدات البنيوية عبر الأنواع الأدبية المختلفة."""

    VOLUME = "volume"                  # جزء
    BOOK_PART = "book_part"            # كتاب (قسم داخل المؤلَّف)
    CHAPTER = "chapter"                # باب
    SECTION = "section"                # فصل
    BIOGRAPHY = "biography"            # ترجمة
    ANNAL = "annal"                    # حوليّة: "ثم دخلت سنة كذا"
    HADITH_REPORT = "hadith_report"    # حديث بإسناده ومتنه
    ISNAD = "isnad"                    # الإسناد وحده
    MATN = "matn"                      # المتن وحده
    ISSUE = "issue"                    # مسألة فقهية
    POEM = "poem"                      # قصيدة
    PARAGRAPH = "paragraph"            # فقرة (احتياطي)


COREF_SCOPE_TYPES: frozenset[SegmentType] = frozenset(
    {
        SegmentType.BIOGRAPHY,
        SegmentType.ANNAL,
        SegmentType.HADITH_REPORT,
        SegmentType.ISSUE,
    }
)
"""الأنواع التي تصلح نطاقًا للإحالة الضميرية: داخل الترجمة، 'قال' و'عنه'
تعود إلى صاحب الترجمة افتراضًا. هذا هو العائد الحقيقي من التقطيع الصحيح."""


class SegmentDetector(str, Enum):
    """كيف اكتُشف هذا المقطع -- مرتّبة تنازليًا بالثقة."""

    MARKUP = "markup"                  # ترميز موجود (mARkdown)
    NUMBERING = "numbering"            # ترقيم المحقق: "١٢٣ -"
    FORMULA = "formula"                # صيغة قالبية: "ثم دخلت سنة"، "باب"
    NAME_PATTERN = "name_pattern"      # سطر يبدأ باسم عَلَم كامل
    TYPOGRAPHY = "typography"          # سطر فارغ، إزاحة، تشكيل الخط
    MODEL = "model"                    # مصنّف مدرَّب
    FALLBACK_WINDOW = "fallback_window"  # نافذة ثابتة -- مؤشر جودة منخفضة


class RelationType(str, Enum):
    # -- شخص <-> شخص -------------------------------------------------------
    NARRATED_FROM = "narrated_from"      # روى عن (من صيغ الإسناد)
    STUDENT_OF = "student_of"            # أخذ عن / تفقّه على / لازم
    SON_OF = "son_of"                    # ابن لـ (مستخرجة من النسب)
    SIBLING_OF = "sibling_of"            # أخو
    APPOINTED = "appointed"              # ولّى
    DISMISSED = "dismissed"              # عزل
    DEBATED = "debated"                  # ناظر
    REFUTED = "refuted"                  # ردّ على (شخص أو كتاب أو فرقة أو دين)
    # -- شخص -> مؤلَّف ------------------------------------------------------
    AUTHORED = "authored"                # ألّف
    TRANSMITTED_WORK = "transmitted_work"  # روى الكتاب
    # -- مؤلَّف -> مؤلَّف ----------------------------------------------------
    COMMENTARY_ON = "commentary_on"      # شرح لـ
    ABRIDGMENT_OF = "abridgment_of"      # مختصر لـ
    GLOSS_ON = "gloss_on"                # حاشية على
    SUPPLEMENT_TO = "supplement_to"      # ذيل لـ
    # -- شخص -> مكان --------------------------------------------------------
    BORN_IN = "born_in"                  # وُلد في
    DIED_IN = "died_in"                  # توفي في
    RESIDED_IN = "resided_in"            # سكن / استقر
    TRAVELED_TO = "traveled_to"          # رحل إلى
    BURIED_IN = "buried_in"              # دُفن في
    NISBA_OF = "nisba_of"                # نُسب إلى (لا تعني السكن أو الولادة)
    # -- شخص -> جماعة -------------------------------------------------------
    MEMBER_OF_TRIBE = "member_of_tribe"  # من قبيلة
    FOLLOWS_MADHHAB = "follows_madhhab"  # على مذهب
    MEMBER_OF_SECT = "member_of_sect"    # ينتمي لفرقة
    # -- شخص -> دين ----------------------------------------------------------
    FOLLOWS_RELIGION = "follows_religion"  # على دين (مسلم، نصراني، يهودي)
    CONVERTED_TO = "converted_to"          # انتقل إليه (أسلم، تنصّر، ارتدّ)
    # -- فرقة -> دين ----------------------------------------------------------
    SECT_OF = "sect_of"                    # فرقة من فرق دين (المعتزلة -> الإسلام)
    # -- شخص -> منصب --------------------------------------------------------
    HELD_OFFICE = "held_office"          # تولّى (مع مكان ومدة كـ qualifiers)
    # -- شخص -> مؤسسة -------------------------------------------------------
    FOUNDED = "founded"                  # أنشأ / بنى / أوقف / أسّس
    AFFILIATED_WITH = "affiliated_with"  # انتسب إليها / عمل فيها (عام)
    TAUGHT_AT = "taught_at"              # درّس بها / ولي التدريس بها
    STUDIED_AT = "studied_at"            # قرأ / تفقّه / تعلّم بها
    # -- مؤلَّف -> مؤسسة -----------------------------------------------------
    PUBLISHED_BY = "published_by"        # نشرته / طبعته (دار نشر أو جامعة)
    # -- مؤسسة -> مكان ------------------------------------------------------
    LOCATED_IN = "located_in"            # مقرّها بـ (النظامية -> بغداد)
    # -- مكان -> مكان، ومؤسسة -> مؤسسة --------------------------------------
    PART_OF = "part_of"                  # جزء من (نيسابور -> خراسان)
    # -- حدث ----------------------------------------------------------------
    PARTICIPATED_IN = "participated_in"  # شارك في / شهد
    OCCURRED_IN = "occurred_in"          # وقع في (حدث -> مكان)


class ClaimPredicate(str, Enum):
    """Literal-valued attributes that conflict across sources.
    Dates live here, NOT as relations or fixed fields."""

    BIRTH_DATE = "birth_date"          # وُلد سنة
    DEATH_DATE = "death_date"          # توفي سنة
    FLOURISHED_IN = "flourished_in"    # كان حيًّا سنة


# ---------------------------------------------------------------------------
# Domain / range constraints for relations (validated automatically)
# ---------------------------------------------------------------------------

_PER = {EntityType.PERSON}
_WRK = {EntityType.WORK}
_PLC = {EntityType.PLACE}
_EVT = {EntityType.EVENT}
_ORG = {EntityType.ORGANIZATION}
_SCT = {EntityType.SECT}
_REL = {EntityType.RELIGION}

RELATION_CONSTRAINTS: dict[RelationType, tuple[set[EntityType], set[EntityType]]] = {
    RelationType.NARRATED_FROM: (_PER, _PER),
    RelationType.STUDENT_OF: (_PER, _PER),
    RelationType.SON_OF: (_PER, _PER),
    RelationType.SIBLING_OF: (_PER, _PER),
    RelationType.APPOINTED: (_PER, _PER),
    RelationType.DISMISSED: (_PER, _PER),
    RelationType.DEBATED: (_PER, _PER),
    RelationType.REFUTED: (_PER | _WRK, _PER | _WRK | _SCT | _REL),
    RelationType.AUTHORED: (_PER, _WRK),
    RelationType.TRANSMITTED_WORK: (_PER, _WRK),
    RelationType.COMMENTARY_ON: (_WRK, _WRK),
    RelationType.ABRIDGMENT_OF: (_WRK, _WRK),
    RelationType.GLOSS_ON: (_WRK, _WRK),
    RelationType.SUPPLEMENT_TO: (_WRK, _WRK),
    RelationType.BORN_IN: (_PER, _PLC),
    RelationType.DIED_IN: (_PER, _PLC),
    RelationType.RESIDED_IN: (_PER, _PLC),
    RelationType.TRAVELED_TO: (_PER, _PLC),
    RelationType.BURIED_IN: (_PER, _PLC),
    RelationType.NISBA_OF: (_PER, _PLC),
    RelationType.MEMBER_OF_TRIBE: (_PER, {EntityType.TRIBE}),
    RelationType.FOLLOWS_MADHHAB: (_PER, _SCT),
    RelationType.MEMBER_OF_SECT: (_PER, _SCT),
    RelationType.FOLLOWS_RELIGION: (_PER, _REL),
    RelationType.CONVERTED_TO: (_PER, _REL),
    RelationType.SECT_OF: (_SCT, _REL),
    RelationType.HELD_OFFICE: (_PER, {EntityType.OFFICE}),
    RelationType.FOUNDED: (_PER, _ORG),
    RelationType.AFFILIATED_WITH: (_PER, _ORG),
    RelationType.TAUGHT_AT: (_PER, _ORG),
    RelationType.STUDIED_AT: (_PER, _ORG),
    RelationType.PUBLISHED_BY: (_WRK, _ORG),
    RelationType.LOCATED_IN: (_ORG, _PLC),
    # مكان -> مكان أو مؤسسة -> مؤسسة. القيد ضرب ديكارتي فلا يمنع الخلط بينهما؛
    # موقع المؤسسة له علاقته الخاصة (located_in) والمطالبة بالفصل على البرومبت.
    RelationType.PART_OF: (_PLC | _ORG, _PLC | _ORG),
    RelationType.PARTICIPATED_IN: (_PER, _EVT),
    RelationType.OCCURRED_IN: (_EVT, _PLC),
}


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


class TextSpan(BaseModel):
    """Character offsets into the source text (immutable)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def _check_order(self) -> "TextSpan":
        if self.end <= self.start:
            raise ValueError("span end must be greater than start")
        return self


class HijriDate(BaseModel):
    """A (possibly partial) Hijri date. Month/day are usually absent."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    year: int = Field(ge=1, le=1600)
    month: int | None = Field(default=None, ge=1, le=12)
    day: int | None = Field(default=None, ge=1, le=30)
    approximate: bool = False  # "نحو سنة..." / "في حدود..."


class HijriRange(BaseModel):
    """Uncertain interval, e.g. 'بضع وأربعين ومائة'."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    earliest: HijriDate
    latest: HijriDate

    @model_validator(mode="after")
    def _check_order(self) -> "HijriRange":
        lo = (self.earliest.year, self.earliest.month or 0, self.earliest.day or 0)
        hi = (self.latest.year, self.latest.month or 0, self.latest.day or 0)
        if hi < lo:
            raise ValueError("latest date precedes earliest date")
        return self


class AbsoluteTime(StrictModel):
    kind: Literal["absolute"] = "absolute"
    date: HijriDate


class TimeRange(StrictModel):
    kind: Literal["range"] = "range"
    range: HijriRange


class RelativeTime(StrictModel):
    """'في خلافة المأمون' -- anchored to an entity, resolvable later."""

    kind: Literal["relative"] = "relative"
    anchor_text: str
    anchor_entity_id: EntityId | None = None


ParsedTime = Annotated[
    AbsoluteTime | TimeRange | RelativeTime, Field(discriminator="kind")
]


class QuranRef(StrictModel):
    ref_kind: Literal["quran"] = "quran"
    sura: int = Field(ge=1, le=114)
    aya_start: int = Field(ge=1)
    aya_end: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _check_range(self) -> "QuranRef":
        if self.aya_end is not None and self.aya_end < self.aya_start:
            raise ValueError("aya_end must be >= aya_start")
        return self


class HadithRef(StrictModel):
    ref_kind: Literal["hadith"] = "hadith"
    collection: str  # "bukhari", "muslim", "tirmidhi", ...
    hadith_number: str


CanonicalRef = Annotated[QuranRef | HadithRef, Field(discriminator="ref_kind")]


class Provenance(StrictModel):
    """Where an assertion came from. Attached to every mention, relation,
    and claim -- this is what makes the KB auditable and repairable."""

    book_id: str = Field(description="OpenITI URI / Shamela id / internal id")
    book_title: str | None = None
    volume: str | None = None
    page: str | None = None
    span: TextSpan | None = None
    segment_id: str | None = Field(
        default=None, description="المقطع البنيوي الذي وُجد فيه (نطاق الإحالة)"
    )
    stream: TextStream = TextStream.MAIN
    extraction_method: ExtractionMethod
    extractor_version: str | None = None
    ocr_source: bool = False
    extracted_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class NameComponents(StrictModel):
    """Decomposition of an Arabic proper name -- a separate analysis layer
    on top of the maximal NER span. Component-level matching is what makes
    entity linking robust to OCR noise."""

    kunya: str | None = None                              # أبو عبد الله
    ism: str | None = None                                # محمد
    nasab: list[str] = Field(default_factory=list)        # آباؤه بالترتيب: إسماعيل، إبراهيم...
    nisba: list[str] = Field(default_factory=list)        # البخاري، الجعفي
    laqab: list[str] = Field(default_factory=list)        # الأعمش
    shuhra: str | None = None                             # الاسم الاختزالي: ابن حجر


# ---------------------------------------------------------------------------
# Structural segmentation
# ---------------------------------------------------------------------------


class Segment(StrictModel):
    """A structural unit of one book.

    CRITICAL: `span` offsets are ABSOLUTE into the full normalized document
    text, never relative to a parent or a window. Chunk-relative offsets make
    every downstream provenance record unresolvable."""

    id: str = Field(default_factory=lambda: _new_id("seg"))
    book_id: str
    segment_type: SegmentType
    stream: TextStream = TextStream.MAIN
    span: TextSpan
    parent_id: str | None = None
    order: int = Field(ge=0, description="ترتيب المقطع بين إخوته")
    title: str | None = Field(default=None, description="عنوان الترجمة/الباب إن وُجد")
    detector: SegmentDetector
    confidence: Confidence = 1.0

    @property
    def is_coref_scope(self) -> bool:
        return self.segment_type in COREF_SCOPE_TYPES

    @property
    def length(self) -> int:
        return self.span.end - self.span.start


class SegmentedDocument(StrictModel):
    """The segment tree for one book, with structural validation that catches
    the classic splitter bugs: overlapping siblings, children escaping their
    parent, dangling parents, offset drift."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    book_id: str
    text_length: int = Field(ge=0, description="طول النص المطبَّع الكامل")
    segments: list[Segment] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_tree(self) -> "SegmentedDocument":
        by_id: dict[str, Segment] = {}
        for seg in self.segments:
            if seg.id in by_id:
                raise ValueError(f"duplicate segment id {seg.id!r}")
            if seg.book_id != self.book_id:
                raise ValueError(f"segment {seg.id!r} belongs to another book")
            if seg.span.end > self.text_length:
                raise ValueError(
                    f"segment {seg.id!r} ends at {seg.span.end}, "
                    f"past document length {self.text_length}"
                )
            by_id[seg.id] = seg

        for seg in self.segments:
            if seg.parent_id is None:
                continue
            parent = by_id.get(seg.parent_id)
            if parent is None:
                raise ValueError(f"segment {seg.id!r}: unknown parent {seg.parent_id!r}")
            if parent.stream is not seg.stream:
                raise ValueError(f"segment {seg.id!r}: stream differs from parent")
            if seg.span.start < parent.span.start or seg.span.end > parent.span.end:
                raise ValueError(
                    f"segment {seg.id!r} escapes parent {parent.id!r} bounds"
                )
            # cycle guard
            seen, cur = {seg.id}, parent
            while cur.parent_id is not None:
                if cur.parent_id in seen:
                    raise ValueError(f"cycle in segment tree at {cur.id!r}")
                seen.add(cur.id)
                cur = by_id[cur.parent_id]

        siblings: dict[tuple[str | None, TextStream], list[Segment]] = {}
        for seg in self.segments:
            siblings.setdefault((seg.parent_id, seg.stream), []).append(seg)
        for group in siblings.values():
            ordered = sorted(group, key=lambda s: s.span.start)
            for prev, nxt in zip(ordered, ordered[1:]):
                if nxt.span.start < prev.span.end:
                    raise ValueError(
                        f"segments {prev.id!r} and {nxt.id!r} overlap "
                        f"({prev.span.end} > {nxt.span.start})"
                    )
        return self

    def leaves(self, stream: TextStream = TextStream.MAIN) -> list[Segment]:
        """Deepest segments in reading order -- the atomic extraction units."""
        parents = {s.parent_id for s in self.segments if s.parent_id}
        return sorted(
            (s for s in self.segments if s.id not in parents and s.stream is stream),
            key=lambda s: s.span.start,
        )


class ExtractionWindow(StrictModel):
    """One model call.

    `context_span` is what the model reads; `focus_span` is the region whose
    mentions are kept. Overlap therefore gives cross-boundary context WITHOUT
    producing duplicate mentions -- anything outside focus is discarded."""

    context_span: TextSpan
    focus_span: TextSpan
    segment_ids: list[str] = Field(min_length=1)
    oversized: bool = Field(
        default=False,
        description=(
            "مقطع واحد (نطاق إحالة: ترجمة/حادثة/حديث/مسألة) تجاوز الحد "
            "ولم يُقطَّع -- القطع كان سيكسر علاقة. أما الأبواب والفصول "
            "الطويلة فتُقطَّع على حدود الفقرات ولا تُعلَّم"
        ),
    )

    @model_validator(mode="after")
    def _focus_inside_context(self) -> "ExtractionWindow":
        if (
            self.focus_span.start < self.context_span.start
            or self.focus_span.end > self.context_span.end
        ):
            raise ValueError("focus_span must lie inside context_span")
        return self


_SENTENCE_ENDS = ".۔؟!"


def _cut_point(text: str | None, lo: int, target: int, hi: int) -> int:
    """Best offset in (lo, hi) to cut at: the boundary nearest `target`, ranked
    paragraph break > line break > sentence end > any whitespace.

    Returns `target` untouched when no text was supplied or the range holds no
    boundary at all. A blind cut is ugly, but the 250-char context overlap
    covers it, and it beats shipping an unsplit 20k-char focus."""
    if not text or hi - lo < 2:
        return target
    nearest: dict[int, int] = {}
    for i in range(lo + 1, min(hi, len(text))):
        ch = text[i]
        if ch == "\n":
            rank = 0 if text[i - 1] == "\n" else 1
        elif ch in _SENTENCE_ENDS:
            rank = 2
        elif ch.isspace():
            rank = 3
        else:
            continue
        cut = i + 1  # cut AFTER the boundary character
        if rank not in nearest or abs(cut - target) < abs(nearest[rank] - target):
            nearest[rank] = cut
    for rank in (0, 1, 2, 3):
        if rank in nearest:
            return nearest[rank]
    return target


def _split_leaf(leaf: Segment, max_chars: int, text: str | None) -> list[tuple[int, int]]:
    """Spans covering `leaf` exactly, each roughly `max_chars` or under.

    Pieces are cut evenly rather than greedily -- a 19,997-char chapter becomes
    seven ~2,857-char windows, not six of 3,000 plus a 1,997-char runt."""
    n_parts = -(-leaf.length // max_chars)  # ceil
    step = leaf.length / n_parts
    tol = max(1, int(step * 0.25))
    spans: list[tuple[int, int]] = []
    start = leaf.span.start
    for k in range(1, n_parts):
        target = leaf.span.start + round(step * k)
        end = _cut_point(text, max(start, target - tol), target,
                         min(leaf.span.end, target + tol))
        end = max(start + 1, min(end, leaf.span.end - 1))
        spans.append((start, end))
        start = end
    spans.append((start, leaf.span.end))
    return spans


def plan_windows(
    doc: SegmentedDocument,
    max_chars: int = 2000,
    overlap: int = 250,
    stream: TextStream = TextStream.MAIN,
    text: str | None = None,
) -> list[ExtractionWindow]:
    """Pack leaf segments into model-sized windows.

    A leaf that is a coreference scope -- ترجمة، حادثة سنة، حديث بإسناده،
    مسألة -- is NEVER split, even when it exceeds `max_chars`: cutting inside
    one destroys the relations that make it worth extracting. Those are flagged
    `oversized` instead, to be routed to a long-context model or reviewed
    rather than silently mangled.

    Every other long leaf (a فصل or باب of running prose) IS split, on
    paragraph boundaries where `text` is supplied and blindly where it is not.
    There is no isnad to break there, and one call asked to enumerate every
    mention across 20k characters quietly misses some.

    Pass `text` (the normalized document text, offsets absolute) to get cuts on
    real boundaries; without it the function still works, just cuts blind."""

    windows: list[ExtractionWindow] = []
    batch: list[Segment] = []

    def emit(start: int, end: int, segment_ids: list[str], oversized: bool) -> None:
        windows.append(
            ExtractionWindow(
                context_span=TextSpan(
                    start=max(0, start - overlap),
                    end=min(doc.text_length, end + overlap),
                ),
                focus_span=TextSpan(start=start, end=end),
                segment_ids=segment_ids,
                oversized=oversized,
            )
        )

    def flush() -> None:
        if not batch:
            return
        emit(
            batch[0].span.start,
            batch[-1].span.end,
            [s.id for s in batch],
            len(batch) == 1 and batch[0].length > max_chars,
        )
        batch.clear()

    for leaf in doc.leaves(stream):
        if leaf.length > max_chars:
            flush()
            if leaf.is_coref_scope:
                batch.append(leaf)
                flush()  # one window, oversized=True
            else:
                for start, end in _split_leaf(leaf, max_chars, text):
                    emit(start, end, [leaf.id], False)
            continue
        if batch and (leaf.span.end - batch[0].span.start) > max_chars:
            flush()
        batch.append(leaf)
    flush()
    return windows


# ---------------------------------------------------------------------------
# Mention layer (NER output)
# ---------------------------------------------------------------------------


class MentionBase(StrictModel):
    id: str = Field(default_factory=lambda: _new_id("men"))
    surface_form: str = Field(min_length=1, description="النص كما ورد (بضوضاء الـ OCR)")
    normalized_form: str | None = Field(
        default=None, description="بعد التطبيع الإملائي (همزات، ى/ي، ة/ه...)"
    )
    provenance: Provenance
    confidence: Confidence = 1.0
    blocking_key: str | None = Field(
        default=None,
        description=(
            "مفتاح تجميع مبدئي للربط اللاحق (مثلًا: شهرة + نسبة مطبّعة). "
            "غير مُلزِم ولا يُعتبر قرار ربط."
        ),
    )
    entity_id: EntityId | None = Field(
        default=None, description="الكيان المربوط؛ None حسب linking_status"
    )
    linking_status: LinkingStatus = LinkingStatus.UNLINKED


class PersonMention(MentionBase):
    label: Literal["person"] = "person"
    name_components: NameComponents | None = None


class PlaceMention(MentionBase):
    label: Literal["place"] = "place"


class WorkMention(MentionBase):
    label: Literal["work"] = "work"
    subtype: WorkSubtype = Field(
        default=WorkSubtype.UNKNOWN,
        description="وعاء المؤلَّف كما يدل عليه النص (كتاب/مخطوط/مجلة...)؛ unknown إن لم يُذكر",
    )


class TribeMention(MentionBase):
    label: Literal["tribe"] = "tribe"


class SectMention(MentionBase):
    label: Literal["sect"] = "sect"
    kind: SectKind = Field(
        default=SectKind.UNKNOWN,
        description="نوع الفرقة كما يدل عليه النص (عقدية/فقهية/صوفية)؛ unknown إن لم يُذكر",
    )


class ReligionMention(MentionBase):
    label: Literal["religion"] = "religion"


class DynastyMention(MentionBase):
    label: Literal["dynasty"] = "dynasty"


class OfficeMention(MentionBase):
    label: Literal["office"] = "office"


class OrganizationMention(MentionBase):
    label: Literal["organization"] = "organization"
    subtype: OrganizationSubtype = Field(
        default=OrganizationSubtype.UNKNOWN,
        description="نوع المؤسسة كما يدل عليه النص؛ unknown إن لم يُذكر",
    )


class EventMention(MentionBase):
    label: Literal["event"] = "event"


class TimeMention(MentionBase):
    """Mention-level only: normalized dates end up inside Claims."""

    label: Literal["time"] = "time"
    parsed: ParsedTime | None = None


class QuotationMention(MentionBase):
    """Mention-level only. Retrieval/matching output, not token classification."""

    label: Literal["quotation"] = "quotation"
    quote_type: QuotationType
    speaker_mention_id: str | None = None  # قائله
    about_mention_id: str | None = None    # المقول فيه (لأقوال العلماء في الرجال)
    canonical_ref: CanonicalRef | None = None      # المرجع المعياري
    match_method: MatchMethod | None = None
    match_score: Confidence | None = None


Mention = Annotated[
    PersonMention
    | PlaceMention
    | WorkMention
    | TribeMention
    | SectMention
    | ReligionMention
    | DynastyMention
    | OfficeMention
    | OrganizationMention
    | EventMention
    | TimeMention
    | QuotationMention,
    Field(discriminator="label"),
]


# ---------------------------------------------------------------------------
# Mention-level assertions (usable BEFORE entity resolution exists)
# ---------------------------------------------------------------------------

MENTION_LABEL_TO_ENTITY_TYPE: dict[str, EntityType] = {
    "person": EntityType.PERSON,
    "place": EntityType.PLACE,
    "work": EntityType.WORK,
    "tribe": EntityType.TRIBE,
    "sect": EntityType.SECT,
    "religion": EntityType.RELIGION,
    "dynasty": EntityType.DYNASTY,
    "office": EntityType.OFFICE,
    "organization": EntityType.ORGANIZATION,
    "event": EntityType.EVENT,
    # "time" and "quotation" have no entity counterpart by design
}


class MentionRelation(StrictModel):
    """A relation between two SPANS in one document.

    This is a fact about the text and stays true no matter how the mentions
    are later resolved. Extract these from day one; project them into
    entity-level `Relation` objects once ER exists (see
    `project_mention_relations`). Time and place are references to sibling
    mentions rather than parsed values, so nothing is lost if date parsing
    is revised later."""

    id: str = Field(default_factory=lambda: _new_id("mrel"))
    relation_type: RelationType
    subject_mention_id: str
    object_mention_id: str
    place_mention_id: str | None = None
    time_mention_id: str | None = None
    provenance: Provenance
    confidence: Confidence = 1.0
    trigger: str | None = Field(
        default=None, description="اللفظ المُشغِّل: حدثنا، سمعت، تفقّه على..."
    )

    @model_validator(mode="after")
    def _distinct(self) -> "MentionRelation":
        if self.subject_mention_id == self.object_mention_id:
            raise ValueError("subject and object mentions must differ")
        return self


class MentionClaim(StrictModel):
    """Literal-valued assertion tied to spans, e.g. 'توفي سنة أربع ومائتين'."""

    id: str = Field(default_factory=lambda: _new_id("mclm"))
    predicate: ClaimPredicate
    subject_mention_id: str
    time_mention_id: str
    provenance: Provenance
    confidence: Confidence = 1.0


class AppraisalScope(StrictModel):
    """Qualifier on a verdict. `target_mention_id` points at the shaykh, work,
    or topic the verdict is restricted to."""

    kind: AppraisalScopeKind = AppraisalScopeKind.GENERAL
    target_mention_id: str | None = None
    note: str | None = None

    @model_validator(mode="after")
    def _general_has_no_target(self) -> "AppraisalScope":
        if self.kind is AppraisalScopeKind.GENERAL and self.target_mention_id:
            raise ValueError("a general scope must not carry a target mention")
        return self


class AppraisalBase(StrictModel):
    """أقوال العلماء في الرجال (الجرح والتعديل).

    Modelled separately from `Relation` because a verdict is not a binary
    link: it carries a graded value, a scope, and -- critically -- the
    scholar who issued it. Two verdicts on the same person are not a
    contradiction to resolve; both are data, and the identity of the critic
    is what makes them interpretable (المتشدّدون vs المتساهلون).

    `verbatim` is REQUIRED and `rank` is OPTIONAL, deliberately: the
    normalization from wording to rank is a contested scholarly judgement,
    so it must always be re-derivable from the preserved original."""

    verbatim: str = Field(
        min_length=1, description="نص الحكم كما ورد: 'ثقة ثبت'، 'ليس بشيء'"
    )
    polarity: AppraisalPolarity
    rank: AppraisalRank | None = None
    scope: AppraisalScope = Field(default_factory=AppraisalScope)
    confidence: Confidence = 1.0

    @model_validator(mode="after")
    def _rank_matches_polarity(self) -> "AppraisalBase":
        if self.rank is None:
            return self
        level = APPRAISAL_RANK_LEVEL[self.rank]
        if self.polarity is AppraisalPolarity.TADIL and level > TADIL_MAX_LEVEL:
            raise ValueError(f"rank {self.rank.value!r} is a jarh rank, not tadil")
        if self.polarity is AppraisalPolarity.JARH and level <= TADIL_MAX_LEVEL:
            raise ValueError(f"rank {self.rank.value!r} is a tadil rank, not jarh")
        return self

    @property
    def level(self) -> int | None:
        """1 (أعلى تعديل) .. 12 (أشد جرح)، أو None إن لم يُصنَّف."""
        return APPRAISAL_RANK_LEVEL[self.rank] if self.rank else None


class MentionAppraisal(AppraisalBase):
    """Document-layer verdict: both parties are spans, no ER required."""

    id: str = Field(default_factory=lambda: _new_id("mapp"))
    critic_mention_id: str    # المُقوِّم (القائل)
    subject_mention_id: str   # المُقوَّم (المقول فيه)
    quotation_mention_id: str | None = None
    provenance: Provenance

    @model_validator(mode="after")
    def _distinct_parties(self) -> "MentionAppraisal":
        if self.critic_mention_id == self.subject_mention_id:
            raise ValueError("critic and subject mentions must differ")
        return self


# ---------------------------------------------------------------------------
# Entity layer (KB nodes)
# ---------------------------------------------------------------------------


class EntityBase(StrictModel):
    id: str = Field(default_factory=lambda: _new_id("ent"))
    canonical_name: str = Field(min_length=1, description="الاسم المعتمد بالعربية")
    aliases: list[str] = Field(default_factory=list)
    external_ids: dict[str, str] = Field(
        default_factory=dict,
        description='{"wikidata": "Q...", "althurayya": "...", "openiti": "...", "viaf": "..."}',
    )
    description: str | None = None


class Person(EntityBase):
    entity_type: Literal["person"] = "person"
    name_components: NameComponents | None = None
    gender: Gender = Gender.UNKNOWN
    is_sacred: bool = Field(
        default=False,
        description="الأنبياء والذات الإلهية: تكرار عالٍ جدًا، تُعامل معاملة خاصة",
    )


class Place(EntityBase):
    entity_type: Literal["place"] = "place"
    subtype: PlaceSubtype
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _coords_pair(self) -> "Place":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self


class Work(EntityBase):
    entity_type: Literal["work"] = "work"
    subtype: WorkSubtype = WorkSubtype.UNKNOWN
    title_variants: list[str] = Field(default_factory=list)
    is_extant: bool | None = Field(
        default=None, description="False للكتب المفقودة المذكورة بالعنوان فقط"
    )
    discipline: str | None = None  # حديث / فقه / تاريخ...


class Tribe(EntityBase):
    entity_type: Literal["tribe"] = "tribe"


class Sect(EntityBase):
    entity_type: Literal["sect"] = "sect"
    kind: SectKind = SectKind.UNKNOWN


class Religion(EntityBase):
    """الدين/الملة نفسها: الإسلام، النصرانية، اليهودية، المجوسية، الصابئة،
    الهندوسية، البوذية. أما الفرقة والمذهب داخل الدين — المعتزلة، الشافعية،
    الأرثوذكس — فتبقى `Sect`، وصلتها بدينها علاقة `sect_of`."""

    entity_type: Literal["religion"] = "religion"


class Dynasty(EntityBase):
    entity_type: Literal["dynasty"] = "dynasty"


class Office(EntityBase):
    entity_type: Literal["office"] = "office"


class Organization(EntityBase):
    """مؤسسة مسمّاة لها كيان اعتباري: المدرسة النظامية، ديوان الإنشاء،
    دار الكتب الظاهرية، جامعة أم القرى، دار الكتب العلمية."""

    entity_type: Literal["organization"] = "organization"
    subtype: OrganizationSubtype = OrganizationSubtype.UNKNOWN


class NamedEvent(EntityBase):
    """Named events only (بدر، صفين، فتنة خلق القرآن).
    Described events / event frames are a later, separate project."""

    entity_type: Literal["event"] = "event"


Entity = Annotated[
    Person | Place | Work | Tribe | Sect | Religion | Dynasty | Office
    | Organization | NamedEvent,
    Field(discriminator="entity_type"),
]


# ---------------------------------------------------------------------------
# Assertion layer: relations and claims
# ---------------------------------------------------------------------------


class Relation(StrictModel):
    """Entity <-> entity link. Multi-source; never overwritten.
    place_id / start / end are qualifiers for reified relations such as
    'تولّى القضاء بالبصرة من سنة كذا إلى سنة كذا'."""

    id: str = Field(default_factory=lambda: _new_id("rel"))
    relation_type: RelationType
    subject_id: EntityId
    subject_type: EntityType
    object_id: EntityId
    object_type: EntityType
    place_id: EntityId | None = Field(
        default=None, description="Qualifier: مكان التولية/الحدث"
    )
    start: HijriDate | None = None
    end: HijriDate | None = None
    sources: list[Provenance] = Field(min_length=1)
    confidence: Confidence = 1.0
    status: AssertionStatus = AssertionStatus.ASSERTED

    @model_validator(mode="after")
    def _check_domain_range(self) -> "Relation":
        domain, range_ = RELATION_CONSTRAINTS[self.relation_type]
        if self.subject_type not in domain:
            raise ValueError(
                f"{self.relation_type.value}: subject type "
                f"{self.subject_type.value!r} not in allowed domain "
                f"{sorted(t.value for t in domain)}"
            )
        if self.object_type not in range_:
            raise ValueError(
                f"{self.relation_type.value}: object type "
                f"{self.object_type.value!r} not in allowed range "
                f"{sorted(t.value for t in range_)}"
            )
        if self.subject_id == self.object_id:
            raise ValueError("relation subject and object must differ")
        if (
            self.start is not None
            and self.end is not None
            and self.end.year < self.start.year
        ):
            raise ValueError("relation end year precedes start year")
        return self


class Claim(StrictModel):
    """Literal-valued assertion (dates mainly). Conflicting claims about the
    same subject+predicate coexist; resolution = flipping `status`, never
    deleting."""

    id: str = Field(default_factory=lambda: _new_id("clm"))
    subject_id: EntityId
    subject_type: EntityType
    predicate: ClaimPredicate
    value: HijriDate | HijriRange
    sources: list[Provenance] = Field(min_length=1)
    confidence: Confidence = 1.0
    status: AssertionStatus = AssertionStatus.ASSERTED


class Appraisal(AppraisalBase):
    """KB-layer verdict, after both critic and subject are resolved."""

    id: str = Field(default_factory=lambda: _new_id("app"))
    critic_id: EntityId
    subject_id: EntityId
    scope_entity_id: EntityId | None = None
    sources: list[Provenance] = Field(min_length=1)
    status: AssertionStatus = AssertionStatus.ASSERTED

    @model_validator(mode="after")
    def _distinct_parties(self) -> "Appraisal":
        if self.critic_id == self.subject_id:
            raise ValueError("critic and subject entities must differ")
        return self


# ---------------------------------------------------------------------------
# Containers
# ---------------------------------------------------------------------------


class DocumentExtraction(StrictModel):
    """Output of the text layer for one document/book chunk.

    Fully usable with NO entity resolution: mentions may all sit at
    `linking_status=UNLINKED` with `entity_id=None`, while relations and
    claims still capture everything the text asserts."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    book_id: str
    mentions: list[Mention] = Field(default_factory=list)
    relations: list[MentionRelation] = Field(default_factory=list)
    claims: list[MentionClaim] = Field(default_factory=list)
    appraisals: list[MentionAppraisal] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_mention_refs(self) -> "DocumentExtraction":
        labels: dict[str, str] = {}
        for m in self.mentions:
            if m.id in labels:
                raise ValueError(f"duplicate mention id {m.id!r}")
            labels[m.id] = m.label

        def require(mid: str, ctx: str) -> str:
            if mid not in labels:
                raise ValueError(f"{ctx}: unknown mention id {mid!r}")
            return labels[mid]

        def require_label(mid: str, expected: str, ctx: str) -> None:
            actual = require(mid, ctx)
            if actual != expected:
                raise ValueError(
                    f"{ctx}: mention {mid!r} is {actual!r}, expected {expected!r}"
                )

        for rel in self.relations:
            ctx = f"relation {rel.id} ({rel.relation_type.value})"
            domain, range_ = RELATION_CONSTRAINTS[rel.relation_type]
            subj_label = require(rel.subject_mention_id, ctx)
            obj_label = require(rel.object_mention_id, ctx)
            subj_type = MENTION_LABEL_TO_ENTITY_TYPE.get(subj_label)
            obj_type = MENTION_LABEL_TO_ENTITY_TYPE.get(obj_label)
            if subj_type not in domain:
                raise ValueError(
                    f"{ctx}: subject label {subj_label!r} not in allowed domain "
                    f"{sorted(t.value for t in domain)}"
                )
            if obj_type not in range_:
                raise ValueError(
                    f"{ctx}: object label {obj_label!r} not in allowed range "
                    f"{sorted(t.value for t in range_)}"
                )
            if rel.place_mention_id is not None:
                require_label(rel.place_mention_id, "place", ctx + " place qualifier")
            if rel.time_mention_id is not None:
                require_label(rel.time_mention_id, "time", ctx + " time qualifier")

        for clm in self.claims:
            ctx = f"claim {clm.id}"
            require(clm.subject_mention_id, ctx)
            require_label(clm.time_mention_id, "time", ctx)

        for app in self.appraisals:
            ctx = f"appraisal {app.id}"
            require_label(app.critic_mention_id, "person", ctx + " critic")
            require_label(app.subject_mention_id, "person", ctx + " subject")
            if app.quotation_mention_id is not None:
                require_label(app.quotation_mention_id, "quotation", ctx)
            if app.scope.target_mention_id is not None:
                require(app.scope.target_mention_id, ctx + " scope target")

        for m in self.mentions:
            if isinstance(m, QuotationMention):
                ctx = f"quotation {m.id}"
                if m.speaker_mention_id is not None:
                    require_label(m.speaker_mention_id, "person", ctx + " speaker")
                if m.about_mention_id is not None:
                    require(m.about_mention_id, ctx + " subject")
        return self


def project_mention_relations(
    doc: DocumentExtraction,
    mention_to_entity: dict[str, EntityId] | None = None,
) -> list[Relation]:
    """Lift mention-level relations to entity-level once ER exists.

    `mention_to_entity` defaults to the `entity_id` already set on each
    mention. Relations whose subject or object is still unlinked are skipped
    -- they stay in the document layer and get picked up on a later pass,
    so re-running ER never requires re-extraction."""

    resolved = mention_to_entity or {
        m.id: m.entity_id for m in doc.mentions if m.entity_id is not None
    }
    labels = {m.id: m.label for m in doc.mentions}
    out: list[Relation] = []
    for rel in doc.relations:
        subj = resolved.get(rel.subject_mention_id)
        obj = resolved.get(rel.object_mention_id)
        if subj is None or obj is None or subj == obj:
            continue
        time_mention = next(
            (m for m in doc.mentions if m.id == rel.time_mention_id), None
        )
        start = None
        if isinstance(time_mention, TimeMention) and isinstance(
            time_mention.parsed, AbsoluteTime
        ):
            start = time_mention.parsed.date
        out.append(
            Relation(
                relation_type=rel.relation_type,
                subject_id=subj,
                subject_type=MENTION_LABEL_TO_ENTITY_TYPE[labels[rel.subject_mention_id]],
                object_id=obj,
                object_type=MENTION_LABEL_TO_ENTITY_TYPE[labels[rel.object_mention_id]],
                place_id=resolved.get(rel.place_mention_id or ""),
                start=start,
                sources=[rel.provenance],
                confidence=rel.confidence,
            )
        )
    return out


def project_mention_appraisals(
    doc: DocumentExtraction,
    mention_to_entity: dict[str, EntityId] | None = None,
) -> list[Appraisal]:
    """Lift document-layer verdicts to the KB once ER exists."""

    resolved = mention_to_entity or {
        m.id: m.entity_id for m in doc.mentions if m.entity_id is not None
    }
    out: list[Appraisal] = []
    for app in doc.appraisals:
        critic = resolved.get(app.critic_mention_id)
        subject = resolved.get(app.subject_mention_id)
        if critic is None or subject is None or critic == subject:
            continue
        out.append(
            Appraisal(
                critic_id=critic,
                subject_id=subject,
                scope_entity_id=resolved.get(app.scope.target_mention_id or ""),
                verbatim=app.verbatim,
                polarity=app.polarity,
                rank=app.rank,
                scope=app.scope,
                confidence=app.confidence,
                sources=[app.provenance],
            )
        )
    return out


class KnowledgeBase(StrictModel):
    """KB fragment with referential-integrity validation: every id referenced
    by a relation or claim must exist and carry the declared type."""

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    entities: list[Entity] = Field(default_factory=list)
    relations: list[Relation] = Field(default_factory=list)
    claims: list[Claim] = Field(default_factory=list)
    appraisals: list[Appraisal] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_referential_integrity(self) -> "KnowledgeBase":
        registry: dict[str, str] = {}
        for ent in self.entities:
            if ent.id in registry:
                raise ValueError(f"duplicate entity id {ent.id!r}")
            registry[ent.id] = ent.entity_type

        def check(eid: str, expected: EntityType, ctx: str) -> None:
            if eid not in registry:
                raise ValueError(f"{ctx}: unknown entity id {eid!r}")
            if registry[eid] != expected.value:
                raise ValueError(
                    f"{ctx}: entity {eid!r} is {registry[eid]!r}, "
                    f"declared {expected.value!r}"
                )

        for rel in self.relations:
            ctx = f"relation {rel.id} ({rel.relation_type.value})"
            check(rel.subject_id, rel.subject_type, ctx)
            check(rel.object_id, rel.object_type, ctx)
            if rel.place_id is not None:
                check(rel.place_id, EntityType.PLACE, ctx + " place qualifier")
        for clm in self.claims:
            check(clm.subject_id, clm.subject_type, f"claim {clm.id}")
        for app in self.appraisals:
            ctx = f"appraisal {app.id}"
            check(app.critic_id, EntityType.PERSON, ctx + " critic")
            check(app.subject_id, EntityType.PERSON, ctx + " subject")
            if app.scope_entity_id is not None and app.scope_entity_id not in registry:
                raise ValueError(f"{ctx}: unknown scope entity {app.scope_entity_id!r}")
        return self


__all__ = [
    "SCHEMA_VERSION",
    "Confidence",
    "EntityId",
    "EntityType",
    "PlaceSubtype",
    "WorkSubtype",
    "OrganizationSubtype",
    "SectKind",
    "QuotationType",
    "ExtractionMethod",
    "LinkingStatus",
    "AssertionStatus",
    "MatchMethod",
    "Gender",
    "AppraisalPolarity",
    "AppraisalRank",
    "APPRAISAL_RANK_LEVEL",
    "TADIL_MAX_LEVEL",
    "AppraisalScopeKind",
    "AppraisalScope",
    "AppraisalBase",
    "MentionAppraisal",
    "Appraisal",
    "project_mention_appraisals",
    "RelationType",
    "ClaimPredicate",
    "RELATION_CONSTRAINTS",
    "TextSpan",
    "HijriDate",
    "HijriRange",
    "AbsoluteTime",
    "TimeRange",
    "RelativeTime",
    "ParsedTime",
    "QuranRef",
    "HadithRef",
    "CanonicalRef",
    "Provenance",
    "NameComponents",
    "TextStream",
    "SegmentType",
    "SegmentDetector",
    "COREF_SCOPE_TYPES",
    "Segment",
    "SegmentedDocument",
    "ExtractionWindow",
    "plan_windows",
    "MentionBase",
    "PersonMention",
    "PlaceMention",
    "WorkMention",
    "TribeMention",
    "SectMention",
    "ReligionMention",
    "DynastyMention",
    "OfficeMention",
    "OrganizationMention",
    "EventMention",
    "TimeMention",
    "QuotationMention",
    "Mention",
    "MENTION_LABEL_TO_ENTITY_TYPE",
    "MentionRelation",
    "MentionClaim",
    "project_mention_relations",
    "EntityBase",
    "Person",
    "Place",
    "Work",
    "Tribe",
    "Sect",
    "Religion",
    "Dynasty",
    "Office",
    "Organization",
    "NamedEvent",
    "Entity",
    "Relation",
    "Claim",
    "DocumentExtraction",
    "KnowledgeBase",
]


# ---------------------------------------------------------------------------
# Smoke test: the worked example from the annotation guidelines
# "حدثنا الحافظ محمد بن إسماعيل البخاري، قال: سمعت أبا عبد الله الشافعي
#  بمصر سنة أربع ومائتين يقول: العلم علمان..."
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # -- Stage 0: segmentation, before any extraction ----------------------
    chapter = Segment(
        book_id="Shamela0001681", segment_type=SegmentType.CHAPTER,
        span=TextSpan(start=0, end=5000), order=0, title="باب من اسمه محمد",
        detector=SegmentDetector.FORMULA, confidence=0.95,
    )
    tarjama_a = Segment(
        book_id="Shamela0001681", segment_type=SegmentType.BIOGRAPHY,
        span=TextSpan(start=40, end=900), parent_id=chapter.id, order=0,
        title="محمد بن إسماعيل البخاري",
        detector=SegmentDetector.NAME_PATTERN, confidence=0.88,
    )
    tarjama_b = Segment(
        book_id="Shamela0001681", segment_type=SegmentType.BIOGRAPHY,
        span=TextSpan(start=900, end=4800), parent_id=chapter.id, order=1,
        detector=SegmentDetector.NUMBERING, confidence=0.93,
    )
    footnote = Segment(
        book_id="Shamela0001681", segment_type=SegmentType.PARAGRAPH,
        stream=TextStream.FOOTNOTE, span=TextSpan(start=4800, end=5000),
        order=0, detector=SegmentDetector.TYPOGRAPHY,
    )
    seg_doc = SegmentedDocument(
        book_id="Shamela0001681", text_length=5000,
        segments=[chapter, tarjama_a, tarjama_b, footnote],
    )
    assert tarjama_a.is_coref_scope and not footnote.is_coref_scope
    assert [s.id for s in seg_doc.leaves()] == [tarjama_a.id, tarjama_b.id]

    windows = plan_windows(seg_doc, max_chars=1000, overlap=100)
    assert len(windows) == 2
    assert windows[0].oversized is False and windows[1].oversized is True
    assert windows[0].context_span.start == 0  # clamped, not negative

    # -- A long coref scope stays whole; a long فصل gets split --------------
    prose = Segment(
        book_id="b2", segment_type=SegmentType.CHAPTER,
        span=TextSpan(start=0, end=5000), order=0, title="مصادر الفن الإسلامي",
        detector=SegmentDetector.MARKUP,
    )
    annal = Segment(
        book_id="b2", segment_type=SegmentType.ANNAL,
        span=TextSpan(start=5000, end=9000), order=1,
        detector=SegmentDetector.MARKUP,
    )
    doc2 = SegmentedDocument(
        book_id="b2", text_length=9000, segments=[prose, annal],
    )
    # Blind cuts: no text given, so pieces land on exact even offsets.
    wins2 = plan_windows(doc2, max_chars=1000, overlap=100)
    prose_wins = [w for w in wins2 if w.segment_ids == [prose.id]]
    annal_wins = [w for w in wins2 if w.segment_ids == [annal.id]]
    assert len(prose_wins) == 5 and not any(w.oversized for w in prose_wins)
    assert len(annal_wins) == 1 and annal_wins[0].oversized  # never split
    # Focus spans still tile the leaf exactly, no gaps and no overlaps.
    assert prose_wins[0].focus_span.start == 0
    assert prose_wins[-1].focus_span.end == 5000
    assert all(a.focus_span.end == b.focus_span.start
               for a, b in zip(prose_wins, prose_wins[1:]))

    # With text, cuts snap to paragraph boundaries instead of round numbers.
    body = ("فقرة. " * 160 + "\n\n") * 5          # 5 paragraphs, ~5,000 chars
    doc3 = SegmentedDocument(
        book_id="b3", text_length=len(body),
        segments=[Segment(book_id="b3", segment_type=SegmentType.CHAPTER,
                          span=TextSpan(start=0, end=len(body)), order=0,
                          detector=SegmentDetector.MARKUP)],
    )
    wins3 = plan_windows(doc3, max_chars=1000, overlap=100, text=body)
    assert not any(w.oversized for w in wins3)
    assert all(body[w.focus_span.start - 1].isspace() for w in wins3[1:]), \
        "cuts must land on whitespace, never mid-word"

    # -- Negative test: overlapping siblings are rejected -------------------
    try:
        SegmentedDocument(
            book_id="b", text_length=100,
            segments=[
                Segment(book_id="b", segment_type=SegmentType.BIOGRAPHY,
                        span=TextSpan(start=0, end=60), order=0,
                        detector=SegmentDetector.MARKUP),
                Segment(book_id="b", segment_type=SegmentType.BIOGRAPHY,
                        span=TextSpan(start=50, end=90), order=1,
                        detector=SegmentDetector.MARKUP),
            ],
        )
        raise AssertionError("sibling overlap check failed to fire")
    except ValueError:
        pass

    prov = Provenance(
        book_id="Shamela0001681",
        book_title="مثال توضيحي",
        page="1/214",
        span=TextSpan(start=120, end=210),
        segment_id=tarjama_a.id,
        stream=TextStream.MAIN,
        extraction_method=ExtractionMethod.LLM,
        extractor_version="pipeline-0.1.0",
        ocr_source=True,
    )

    bukhari = Person(
        canonical_name="محمد بن إسماعيل البخاري",
        aliases=["البخاري", "أبو عبد الله البخاري"],
        name_components=NameComponents(
            kunya="أبو عبد الله",
            ism="محمد",
            nasab=["إسماعيل", "إبراهيم", "المغيرة"],
            nisba=["البخاري", "الجعفي"],
            shuhra="البخاري",
        ),
        gender=Gender.MALE,
        external_ids={"wikidata": "Q152087"},
    )
    shafii = Person(
        canonical_name="محمد بن إدريس الشافعي",
        aliases=["الشافعي", "أبو عبد الله الشافعي"],
        name_components=NameComponents(
            kunya="أبو عبد الله", ism="محمد", nasab=["إدريس"], nisba=["الشافعي"],
            shuhra="الشافعي",
        ),
        gender=Gender.MALE,
    )
    egypt = Place(canonical_name="مصر", subtype=PlaceSubtype.REGION)
    hafiz = Office(canonical_name="الحافظ", description="لقب وظيفي في علم الحديث")

    relations = [
        Relation(
            relation_type=RelationType.NARRATED_FROM,
            subject_id=bukhari.id, subject_type=EntityType.PERSON,
            object_id=shafii.id, object_type=EntityType.PERSON,
            sources=[prov], confidence=0.92,
        ),
        Relation(
            relation_type=RelationType.HELD_OFFICE,
            subject_id=bukhari.id, subject_type=EntityType.PERSON,
            object_id=hafiz.id, object_type=EntityType.OFFICE,
            sources=[prov], confidence=0.85,
        ),
        Relation(
            relation_type=RelationType.RESIDED_IN,
            subject_id=shafii.id, subject_type=EntityType.PERSON,
            object_id=egypt.id, object_type=EntityType.PLACE,
            start=HijriDate(year=204),
            sources=[prov], confidence=0.8,
        ),
    ]
    claims = [
        Claim(
            subject_id=shafii.id, subject_type=EntityType.PERSON,
            predicate=ClaimPredicate.DEATH_DATE,
            value=HijriDate(year=204),
            sources=[prov], confidence=0.95,
        ),
    ]

    kb = KnowledgeBase(
        entities=[bukhari, shafii, egypt, hafiz],
        relations=relations,
        claims=claims,
    )

    # -- Stage 1: extraction with NO entity resolution whatsoever -----------
    m_hafiz = OfficeMention(surface_form="الحافظ", provenance=prov)
    m_bukhari = PersonMention(
        surface_form="محمد بن إسماعيل البخاري", provenance=prov, confidence=0.97,
        blocking_key="بخاري|محمد",
        name_components=NameComponents(
            ism="محمد", nasab=["إسماعيل"], nisba=["البخاري"]
        ),
    )
    m_shafii = PersonMention(
        surface_form="أبا عبد الله الشافعي",
        normalized_form="أبو عبد الله الشافعي",
        provenance=prov, confidence=0.94, blocking_key="شافعي|عبدالله",
    )
    m_egypt = PlaceMention(
        surface_form="بمصر", normalized_form="مصر", provenance=prov
    )
    m_year = TimeMention(
        surface_form="سنة أربع ومائتين", provenance=prov,
        parsed=AbsoluteTime(date=HijriDate(year=204)),
    )
    m_quote = QuotationMention(
        surface_form="العلم علمان: علم الأديان وعلم الأبدان",
        provenance=prov, quote_type=QuotationType.ATHAR,
        speaker_mention_id=m_shafii.id,
        match_method=MatchMethod.FUZZY, match_score=0.88,
    )
    m_gaza = PlaceMention(surface_form="غزة", provenance=prov)
    m_qatada = PersonMention(surface_form="قتادة", provenance=prov)

    doc = DocumentExtraction(
        book_id="Shamela0001681",
        mentions=[
            m_hafiz, m_bukhari, m_shafii, m_egypt, m_year, m_quote,
            m_gaza, m_qatada,
        ],
        appraisals=[
            # حكم مطلق
            MentionAppraisal(
                critic_mention_id=m_bukhari.id,
                subject_mention_id=m_shafii.id,
                verbatim="ثقة ثبت",
                polarity=AppraisalPolarity.TADIL,
                rank=AppraisalRank.THIQA_THIQA,
                provenance=prov, confidence=0.9,
            ),
            # حكم مقيَّد بشيخ بعينه -- ليس حكمًا مطلقًا وليس تناقضًا مع سابقه
            MentionAppraisal(
                critic_mention_id=m_bukhari.id,
                subject_mention_id=m_shafii.id,
                verbatim="ثقة إلا في روايته عن قتادة",
                polarity=AppraisalPolarity.MIXED,
                scope=AppraisalScope(
                    kind=AppraisalScopeKind.IN_SHAYKH,
                    target_mention_id=m_qatada.id,
                ),
                provenance=prov, confidence=0.75,
            ),
            # حكم بلا تصنيف: النص محفوظ والتصنيف مؤجَّل
            MentionAppraisal(
                critic_mention_id=m_shafii.id,
                subject_mention_id=m_qatada.id,
                verbatim="ما رأيت أحفظ منه",
                polarity=AppraisalPolarity.NEUTRAL,
                provenance=prov, confidence=0.6,
            ),
        ],
        relations=[
            MentionRelation(
                relation_type=RelationType.BORN_IN,
                subject_mention_id=m_shafii.id,
                object_mention_id=m_gaza.id,
                provenance=prov, confidence=0.7,
            ),
            MentionRelation(
                relation_type=RelationType.DIED_IN,
                subject_mention_id=m_shafii.id,
                object_mention_id=m_egypt.id,
                time_mention_id=m_year.id,
                provenance=prov, confidence=0.9,
            ),
            MentionRelation(
                relation_type=RelationType.NARRATED_FROM,
                subject_mention_id=m_bukhari.id,
                object_mention_id=m_shafii.id,
                trigger="سمعت", provenance=prov, confidence=0.92,
            ),
            MentionRelation(
                relation_type=RelationType.HELD_OFFICE,
                subject_mention_id=m_bukhari.id,
                object_mention_id=m_hafiz.id,
                provenance=prov, confidence=0.85,
            ),
            MentionRelation(
                relation_type=RelationType.RESIDED_IN,
                subject_mention_id=m_shafii.id,
                object_mention_id=m_egypt.id,
                time_mention_id=m_year.id,
                provenance=prov, confidence=0.8,
            ),
        ],
    )
    assert all(m.linking_status is LinkingStatus.UNLINKED for m in doc.mentions)
    assert project_mention_relations(doc) == [], "no ER yet -> nothing projects"
    assert project_mention_appraisals(doc) == []
    assert doc.appraisals[0].level == 2 and doc.appraisals[1].level is None

    # -- Negative test: a jarh rank cannot be filed under tadil -------------
    try:
        MentionAppraisal(
            critic_mention_id=m_bukhari.id, subject_mention_id=m_shafii.id,
            verbatim="متروك", polarity=AppraisalPolarity.TADIL,
            rank=AppraisalRank.MATRUK, provenance=prov,
        )
        raise AssertionError("polarity/rank consistency check failed to fire")
    except ValueError:
        pass

    # -- Negative test: a general verdict cannot carry a scope target ------
    try:
        AppraisalScope(
            kind=AppraisalScopeKind.GENERAL, target_mention_id=m_qatada.id
        )
        raise AssertionError("scope check failed to fire")
    except ValueError:
        pass

    # -- Stage 2: ER runs later; the SAME document projects cleanly ---------
    gaza = Place(canonical_name="غزة", subtype=PlaceSubtype.SETTLEMENT)
    qatada = Person(canonical_name="قتادة بن دعامة السدوسي", gender=Gender.MALE)
    er_map = {
        m_bukhari.id: bukhari.id,
        m_shafii.id: shafii.id,
        m_egypt.id: egypt.id,
        m_hafiz.id: hafiz.id,
        m_gaza.id: gaza.id,
        m_qatada.id: qatada.id,
    }
    linked = project_mention_relations(doc, er_map)
    assert len(linked) == 5, linked
    assert any(
        r.relation_type is RelationType.DIED_IN
        and r.object_id == egypt.id
        and r.start is not None
        and r.start.year == 204
        for r in linked
    )
    assert any(
        r.relation_type is RelationType.BORN_IN and r.object_id == gaza.id
        for r in linked
    )

    linked_appraisals = project_mention_appraisals(doc, er_map)
    assert len(linked_appraisals) == 3
    scoped = [a for a in linked_appraisals if a.scope_entity_id == qatada.id]
    assert len(scoped) == 1 and scoped[0].polarity is AppraisalPolarity.MIXED

    kb_full = KnowledgeBase(
        entities=[bukhari, shafii, egypt, hafiz, gaza, qatada],
        relations=linked,
        appraisals=linked_appraisals,
    )
    assert len(kb_full.appraisals) == 3

    # -- Negative test: mention-level domain/range is enforced too ----------
    try:
        DocumentExtraction(
            book_id="x",
            mentions=[m_egypt, m_bukhari],
            relations=[
                MentionRelation(
                    relation_type=RelationType.AUTHORED,
                    subject_mention_id=m_egypt.id,
                    object_mention_id=m_bukhari.id,
                    provenance=prov,
                )
            ],
        )
        raise AssertionError("mention-level domain check failed to fire")
    except ValueError:
        pass

    # -- Negative test: domain/range validation must reject a bad relation --
    try:
        Relation(
            relation_type=RelationType.AUTHORED,
            subject_id=egypt.id, subject_type=EntityType.PLACE,
            object_id=bukhari.id, object_type=EntityType.PERSON,
            sources=[prov],
        )
        raise AssertionError("domain/range validation failed to fire")
    except ValueError:
        pass

    # -- Negative test: referential integrity in the KB ---------------------
    try:
        KnowledgeBase(
            entities=[bukhari],
            relations=[
                Relation(
                    relation_type=RelationType.NARRATED_FROM,
                    subject_id=bukhari.id, subject_type=EntityType.PERSON,
                    object_id="ent_missing", object_type=EntityType.PERSON,
                    sources=[prov],
                )
            ],
        )
        raise AssertionError("referential integrity check failed to fire")
    except ValueError:
        pass

    print(f"entities={len(kb.entities)} relations={len(kb.relations)} "
          f"claims={len(kb.claims)} mentions={len(doc.mentions)}")
    print(kb.model_dump_json(indent=2, exclude_none=True)[:600], "...")
    print("SMOKE TEST PASSED")
