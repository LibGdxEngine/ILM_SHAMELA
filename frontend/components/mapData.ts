export interface FakeBook {
    id: number;
    title: string;
    author: string;
    category: string;
    writtenDate: string;
    language: string;
    /** gradient from */
    gradFrom: string;
    /** gradient to */
    gradTo: string;
    accent: string;
}

export interface CountryBooks {
    countryName: string;
    flag: string;
    books: FakeBook[];
}

export const COUNTRY_BOOKS: Record<string, CountryBooks> = {
    Egypt: {
        countryName: 'Egypt',
        flag: '🇪🇬',
        books: [
            { id: 1, title: 'الإتقان في علوم القرآن', author: 'جلال الدين السيوطي', category: 'تفسير', writtenDate: '1498 CE', language: 'ar', gradFrom: '#2e2010', gradTo: '#4a3318', accent: '#d4ad50' },
            { id: 2, title: 'فتح الباري', author: 'ابن حجر العسقلاني', category: 'حديث', writtenDate: '1449 CE', language: 'ar', gradFrom: '#2a1810', gradTo: '#48281a', accent: '#c89870' },
            { id: 3, title: 'المقدمة في علم التفسير', author: 'ابن تيمية', category: 'تفسير', writtenDate: '1320 CE', language: 'ar', gradFrom: '#2e2010', gradTo: '#4a3318', accent: '#d4ad50' },
            { id: 4, title: 'إحياء علوم الدين', author: 'الإمام الغزالي', category: 'تصوف', writtenDate: '1106 CE', language: 'ar', gradFrom: '#241a2e', gradTo: '#3c2c4a', accent: '#a890c8' },
            { id: 5, title: 'الأم', author: 'الإمام الشافعي', category: 'فقه', writtenDate: '820 CE', language: 'ar', gradFrom: '#1a2818', gradTo: '#2d4424', accent: '#9bbf80' },
        ],
    },
    Iraq: {
        countryName: 'Iraq',
        flag: '🇮🇶',
        books: [
            { id: 6, title: 'المبسوط', author: 'السرخسي', category: 'فقه', writtenDate: '1090 CE', language: 'ar', gradFrom: '#1a2818', gradTo: '#2d4424', accent: '#9bbf80' },
            { id: 7, title: 'مسند أحمد', author: 'أحمد بن حنبل', category: 'حديث', writtenDate: '855 CE', language: 'ar', gradFrom: '#2a1810', gradTo: '#48281a', accent: '#c89870' },
            { id: 8, title: 'مقامات الحريري', author: 'الحريري', category: 'أدب', writtenDate: '1122 CE', language: 'ar', gradFrom: '#2c1a26', gradTo: '#48283e', accent: '#c890b0' },
        ],
    },
    'Saudi Arabia': {
        countryName: 'Saudi Arabia',
        flag: '🇸🇦',
        books: [
            { id: 9, title: 'زاد المعاد', author: 'ابن القيم', category: 'سيرة', writtenDate: '1350 CE', language: 'ar', gradFrom: '#1f242c', gradTo: '#323a48', accent: '#94a5b8' },
            { id: 10, title: 'كتاب التوحيد', author: 'محمد بن عبد الوهاب', category: 'عقيدة', writtenDate: '1750 CE', language: 'ar', gradFrom: '#2c2010', gradTo: '#48341a', accent: '#cca065' },
        ],
    },
    Syria: {
        countryName: 'Syria',
        flag: '🇸🇾',
        books: [
            { id: 11, title: 'تفسير ابن كثير', author: 'ابن كثير', category: 'تفسير', writtenDate: '1370 CE', language: 'ar', gradFrom: '#2e2010', gradTo: '#4a3318', accent: '#d4ad50' },
            { id: 12, title: 'رياض الصالحين', author: 'الإمام النووي', category: 'حديث', writtenDate: '1277 CE', language: 'ar', gradFrom: '#2a1810', gradTo: '#48281a', accent: '#c89870' },
        ],
    },
    Morocco: {
        countryName: 'Morocco',
        flag: '🇲🇦',
        books: [
            { id: 13, title: 'المقدمة', author: 'ابن خلدون', category: 'تاريخ', writtenDate: '1377 CE', language: 'ar', gradFrom: '#2e1414', gradTo: '#4d2020', accent: '#c87060' },
            { id: 14, title: 'الموافقات', author: 'الشاطبي', category: 'أصول الفقه', writtenDate: '1388 CE', language: 'ar', gradFrom: '#152828', gradTo: '#244444', accent: '#7caca8' },
        ],
    },
    Tunisia: {
        countryName: 'Tunisia',
        flag: '🇹🇳',
        books: [
            { id: 15, title: 'الأحكام السلطانية', author: 'الماوردي', category: 'فقه', writtenDate: '1058 CE', language: 'ar', gradFrom: '#1a2818', gradTo: '#2d4424', accent: '#9bbf80' },
        ],
    },
    Iran: {
        countryName: 'Iran',
        flag: '🇮🇷',
        books: [
            { id: 16, title: 'القانون في الطب', author: 'ابن سينا', category: 'فلسفة', writtenDate: '1025 CE', language: 'ar', gradFrom: '#1a1a2e', gradTo: '#28284a', accent: '#8c84d0' },
            { id: 17, title: 'مثنوي', author: 'جلال الدين الرومي', category: 'تصوف', writtenDate: '1273 CE', language: 'ar', gradFrom: '#241a2e', gradTo: '#3c2c4a', accent: '#a890c8' },
        ],
    },
    Spain: {
        countryName: 'Spain',
        flag: '🇪🇸',
        books: [
            { id: 18, title: 'بداية المجتهد', author: 'ابن رشد', category: 'فقه', writtenDate: '1188 CE', language: 'ar', gradFrom: '#1a2818', gradTo: '#2d4424', accent: '#9bbf80' },
            { id: 19, title: 'طوق الحمامة', author: 'ابن حزم', category: 'أدب', writtenDate: '1022 CE', language: 'ar', gradFrom: '#2c1a26', gradTo: '#48283e', accent: '#c890b0' },
        ],
    },
    Turkey: {
        countryName: 'Turkey',
        flag: '🇹🇷',
        books: [
            { id: 20, title: 'حاشية ابن عابدين', author: 'ابن عابدين', category: 'فقه', writtenDate: '1836 CE', language: 'ar', gradFrom: '#1a2818', gradTo: '#2d4424', accent: '#9bbf80' },
        ],
    },
    India: {
        countryName: 'India',
        flag: '🇮🇳',
        books: [
            { id: 21, title: 'حجة الله البالغة', author: 'شاه ولي الله الدهلوي', category: 'أصول الفقه', writtenDate: '1762 CE', language: 'ar', gradFrom: '#152828', gradTo: '#244444', accent: '#7caca8' },
        ],
    },
    Libya: {
        countryName: 'Libya',
        flag: '🇱🇾',
        books: [
            { id: 22, title: 'الكتاب', author: 'سيبويه', category: 'لغة', writtenDate: '796 CE', language: 'ar', gradFrom: '#142628', gradTo: '#214144', accent: '#7cb4ad' },
        ],
    },
    'United States of America': {
        countryName: 'United States',
        flag: '🇺🇸',
        books: [
            { id: 23, title: 'Purification of the Heart', author: 'Hamza Yusuf', category: 'تصوف', writtenDate: '2004 CE', language: 'en', gradFrom: '#241a2e', gradTo: '#3c2c4a', accent: '#a890c8' },
        ],
    },
};
