export type FidelityField = {
  name:string;
  label:string;
  type?:'text'|'number'|'date'|'time'|'textarea'|'select'|'checkbox'|'radio'|'file';
  required?:boolean;
  options?:string[];
  placeholder?:string;
  wide?:boolean;
};

export type FidelityDialog = {
  title:string;
  submitLabel:string;
  description?:string;
  fields:FidelityField[];
};

const f=(name:string,label:string,type:FidelityField['type']='text',options?:string[],required=false,wide=false):FidelityField=>({name,label,type,options,required,wide,placeholder:label});

const customerFields:FidelityField[]=[
  f('personType','نوع شخص','radio',['مشتری حقیقی','مشتری حقوقی'],true,true),
  f('fullName','نام و نام خانوادگی','text',undefined,true),f('mobile','شماره همراه','text',undefined,true),f('membership','کد اشتراک'),f('nationalCode','کد ملی'),
  f('gender','جنسیت','select',['آقا','خانم','سایر','نامشخص']),f('birthDate','تاریخ تولد','date'),f('category','انتخاب دسته‌بندی مشتریان','select',['وفادار','جدید','در خطر ریزش']),
  f('customerType','نوع مشتری','select',['مشتری','تأمین‌کننده','مشتری سازمانی']),f('position','سمت'),f('landline','تلفن ثابت ۱'),f('cooperation','نوع همکاری','select',['خریدار','فروشنده','همکار']),
  f('contract','نوع قرارداد','select',['نقدی','اعتباری','پیمانی']),f('costCenter','مرکز هزینه','select',['شعبه اصلی','آشپزخانه','فروش']),f('address','آدرس','textarea',undefined,false,true),f('notes','توضیحات','textarea',undefined,false,true)
];

const campaignFields:FidelityField[]=[
  f('title','عنوان کمپین','text',undefined,true),f('type','نوع کمپین','select',['General','Score','Customers','Birthday','Club_Point','Referral_Code','Coupon'],true),
  f('category','انتخاب دسته‌بندی','select',['همه مشتریان','وفادار','جدید']),f('product','محصول','select',['همه محصولات','چلو کباب','قهوه','برگر']),f('channel','کانال فروش','select',['همه','حضوری','سایت','تلفنی','کیوسک']),
  f('priority','اولویت','number'),f('discount','درصد تخفیف','number'),f('credit','درصد اعتباردهی','number'),f('minimum','حداقل مبلغ خرید (تومان)','number'),f('maximum','حداکثر مبلغ تخفیف (تومان)','number'),f('totalMaximum','حداکثر مجموع تخفیف (تومان)','number'),
  f('invoiceLimit','محدودیت تعداد صورت‌حساب','number'),f('dailyProductLimit','محدودیت تعداد محصول - در روز','number'),f('monthlyProductLimit','محدودیت تعداد محصول - در ماه','number'),f('totalProductLimit','محدودیت تعداد محصول - در کل','number'),
  f('campaignDate','تاریخ کمپین','date'),f('startTime','ساعت شروع تخفیف','time'),f('endTime','ساعت پایان تخفیف','time'),f('creditDays','مدت استفاده از اعتبار پس از پرداخت (روز)','number'),
  ...['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'].map((day,index)=>f('day'+index,day,'checkbox')),
  f('otp','ارسال کد یکبار مصرف','checkbox'),f('site','نمایش کمپین در سایت و منو آنلاین','checkbox')
];

export const screenPatches:Record<string,{
  createLabel?:string;
  primaryLabel?:string;
  fields?:FidelityField[];
  filters?:string[];
  toolbarActions?:string[];
  rowActions?:string[];
  tabs?:string[];
  referencePath?:string;
}>={
  categories:{referencePath:'/panel/menu/categories',rowActions:['ویرایش','حذف']},
  products:{referencePath:'/panel/menu/menulist',fields:[f('language','زبان','select',['فارسی','English'],true),f('name','نام محصول','text',undefined,true),f('category','انتخاب دسته‌بندی','select',['کافی‌شاپ','رستوران','فست‌فود','فروش وزنی'],true),f('code','کد محصول'),f('pricing','نوع قیمت‌گذاری','radio',['قیمت ثابت','وزنی - قیمت هر گرم'],true),f('price','قیمت (تومان)','number',undefined,true),f('vat','ارزش افزوده (درصد)','number'),f('packaging','بسته‌بندی محصول (تومان)','number'),f('prep','زمان آماده‌سازی (دقیقه)','number'),f('image','تصویر محصول','file'),f('additives','افزودنی‌های مجاز','select',['بدون افزودنی','سس پنیر','شات اسپرسو','سیروپ کارامل']),f('description','توضیحات','textarea',undefined,false,true),f('status','محصول فعال','checkbox'),f('available','موجود','checkbox'),f('siteVisible','نمایش در سایت','checkbox'),f('survey','شرکت در نظرسنجی','checkbox'),f('inventoryControl','ساخت رسپی و اتصال به کنترل موجودی','checkbox'),f('preventSale','جلوگیری از فروش در صورت کسری مواد رسپی','checkbox')],rowActions:['حذف']},
  additives:{referencePath:'/panel/menu/additiveList',rowActions:['ویرایش','حذف']},
  'product-sales':{referencePath:'/panel/report/menu'},
  'category-sales':{referencePath:'/panel/report/menu-category',toolbarActions:['جمع‌بندی']},
  'open-bills':{referencePath:'/panel/bills/create'},
  'bill-list':{referencePath:'/panel/bills/list',toolbarActions:['جمع‌بندی'],rowActions:['باز کردن مجدد','تغییرات صورت‌حساب','مشاهده جزئیات','برگرداندن تحویل','تأیید تحویل','چاپ']},
  'customer-categories':{referencePath:'/panel/crm-category',fields:[f('name','نام دسته‌بندی مشتریان','text',undefined,true),f('fromScore','از امتیاز','number'),f('toScore','تا امتیاز','number'),f('description','توضیحات','textarea',undefined,false,true)],rowActions:['ویرایش','حذف']},
  customers:{referencePath:'/panel/crm',fields:customerFields,filters:['نام و نام خانوادگی','شماره همراه','نوع شخص','نوع مشتری','دسته‌بندی مشتری','وضعیت'],rowActions:[]},
  'sms-list':{referencePath:'/panel/smsList',rowActions:['مشاهده']},
  'customer-params':{referencePath:'/panel/crm-params-list'},
  'customer-report':{referencePath:'/panel/report/customer-club-report'},
  'club-settings':{referencePath:'/panel/customerClubSetting'},
  campaigns:{referencePath:'/panel/discountList',fields:campaignFields,rowActions:[]},
  messages:{referencePath:'/panel/crmNotification',fields:[f('messageType','نوع پیام','radio',['پیامک معمولی','پیامک دوره‌ای'],true,true),f('title','عنوان پیام','text',undefined,true),f('audience','انتخاب مشتریان','select',['همه مشتریان','دسته‌بندی مشتریان','انتخاب دستی'],true),f('text','متن پیام','textarea',undefined,true,true),f('merchantName','ماپرا (افزودن نام پذیرنده به انتهای متن پیام)','checkbox'),f('customerName','نمایش نام مشتری در ابتدای پیام (مثلا علی عزیز)','checkbox'),f('draft','پیش‌نویس پیام','checkbox')]},
  wallet:{referencePath:'/panel/customerWallet',createLabel:'',toolbarActions:['جمع‌بندی','کاهش موجودی مشتری','افزایش موجودی مشتری']},
  'wallet-packages':{referencePath:'/panel/walletPackages',fields:[f('amount','مبلغ بسته','number',undefined,true),f('price','قیمت فروش','number',undefined,true),f('active','فعال','checkbox')]},
  'credit-cards':{referencePath:'/panel/creditCardList',fields:[f('customer','انتخاب مشتری','select',['مشتری نمونه','مشتری سازمانی'],true),f('cardNumber','شماره کارت ۱۶ رقمی','text',undefined,true),f('amount','مبلغ (تومان)','number',undefined,true),f('count','تعداد کارت اعتباری','number'),f('issuer','صادرکننده'),f('expiry','تاریخ انقضا','date'),f('activeDays','تعداد روز فعال پس از اولین استفاده','number'),f('minimum','حداقل مبلغ خرید (تومان)','number'),f('maximum','حداکثر مبلغ (تومان)','number'),f('specificDays','استفاده در روزهای مشخص','checkbox'),f('sellable','قابل فروش است','checkbox'),f('active','کارت اعتباری فعال است','checkbox'),f('description','توضیحات','textarea',undefined,false,true)]},
  'campaign-report':{referencePath:'/panel/report/discount',toolbarActions:['جمع‌بندی']},
  'credit-report':{referencePath:'/panel/report/report-creditCard-history',toolbarActions:['جمع‌بندی']},
  'survey-settings':{referencePath:'/panel/survaySetting',fields:[f('title','عنوان','text',undefined,true),f('question','متن سوال','textarea',undefined,true,true),f('channel','کانال فروش','select',['همه','حضوری','سایت','کیوسک']),f('priority','اولویت','number'),f('active','فعال','checkbox')],rowActions:['ویرایش','حذف']},
  comments:{referencePath:'/panel/commentList',rowActions:['تأیید نظر','مشاهده']},
  'survey-report':{referencePath:'/panel/report/survey',tabs:['براساس مشتری','براساس آیتم نظرسنجی','آمار نظرسنجی']},
  units:{referencePath:'/panel/store/measureList',fields:[f('name','نام واحد اندازه‌گیری','text',undefined,true),f('description','توضیحات','textarea',undefined,false,true)],rowActions:['ویرایش','حذف']},
  'material-categories':{referencePath:'/panel/store/goods-category-List',fields:[f('name','نام دسته‌بندی','text',undefined,true),f('description','توضیحات','textarea',undefined,false,true)],rowActions:['ویرایش','حذف']},
  materials:{referencePath:'/panel/store/goodsList',fields:[f('name','نام ماده اولیه','text',undefined,true),f('category','دسته‌بندی ماده اولیه','select',['نوشیدنی','خشکبار','پروتئین','لبنیات'],true),f('unit','واحد اندازه‌گیری','select',['گرم','کیلوگرم','لیتر','میلی‌لیتر','عدد'],true),f('reorder','نقطه سفارش','number'),f('middle','میانه','checkbox'),f('description','توضیحات','textarea',undefined,false,true),f('blockSale','جلوگیری از فروش در صورت اتمام موجودی','checkbox')],toolbarActions:['انتخاب از لیست پیش‌فرض'],rowActions:['ویرایش','حذف']},
  warehouses:{referencePath:'/panel/store/storageList',fields:[f('name','نام انبار','text',undefined,true),f('code','کد انبار'),f('capacity','ظرفیت','number'),f('description','توضیحات','textarea',undefined,false,true)],rowActions:['ویرایش','حذف']},
  movements:{referencePath:'/panel/store/storeList',toolbarActions:['جمع‌بندی']},
  production:{referencePath:'/panel/store/goodsConverterList',rowActions:['جزئیات رسپی','ویرایش','حذف']},
  stocktaking:{referencePath:'/panel/store/storeRecord',rowActions:['مشاهده']},
  wastage:{referencePath:'/panel/store/wastage',toolbarActions:['جمع‌بندی']},
  'stock-report':{referencePath:'/panel/report/stock',toolbarActions:['پیشنهاد خرید مواد اولیه','جمع‌بندی']},
  'cost-report':{referencePath:'/panel/report/cost',tabs:['محصول','مواد اولیه','افزودنی']},
  'forecast-report':{referencePath:'/panel/report/report-ingredient'},
  'product-reservation':{referencePath:'/panel/reservation/menuReservation'},
  'reservation-orders':{referencePath:'/panel/reservation/Orders',toolbarActions:['خلاصه رزرواسیون','رزرو دسته‌جمعی'],fields:[f('meal','انتخاب وعده','select',['صبحانه','ناهار','شام'],true),f('date','تاریخ رزرو','date',undefined,true),f('mobile','شماره همراه','text',undefined,true)]},
  'event-reservation':{referencePath:'/panel/services'},
  'terminal-reservation':{referencePath:'/panel/reservation',fields:[f('mobile','شماره همراه','text',undefined,true),f('date','تاریخ رزرو','date',undefined,true),f('guests','تعداد افراد','number'),f('start','ساعت شروع','time'),f('end','ساعت پایان','time'),f('description','توضیحات','textarea',undefined,false,true)]},
  kds:{referencePath:'/panel/kds',toolbarActions:['علامت‌گذاری همه سفارش‌ها به پایان آماده‌سازی','علامت‌گذاری همه سفارش‌ها به در حال آماده‌سازی']},
  finance:{referencePath:'/panel/macc',createLabel:'',toolbarActions:['ثبت پرداخت','ثبت دریافت','جمع‌بندی'],rowActions:['مشاهده']},
  settlement:{referencePath:'/panel/macc/report/settle'},
  'financial-analysis':{referencePath:'/panel/macc/report/financialAnalysis',toolbarActions:['جمع‌بندی']},
  'branch-analysis':{referencePath:'/panel/macc/report/report-holding-branches'},
  ledger:{referencePath:'/panel/macc/report/expenses',toolbarActions:['جمع‌بندی']},
  'expense-categories':{referencePath:'/panel/macc/costs/costs-categoryList',rowActions:['ویرایش','حذف']},
  expenses:{referencePath:'/panel/macc/costs/costs-list',toolbarActions:['جمع‌بندی هزینه‌ها']},
  people:{referencePath:'/panel/macc/people',fields:customerFields,rowActions:[]},
  theme:{referencePath:'/panel/settgins/shopTheme',primaryLabel:'ثبت',toolbarActions:['تنظیم به پیش‌فرض']},
  sliders:{referencePath:'/panel/settings/shopSliders'},
  'notices-list':{referencePath:'/panel/settings/shopAds',fields:[f('title','عنوان','text',undefined,true),f('description','توضیحات','textarea',undefined,true,true)]},
  'working-hours':{referencePath:'/panel/settings/workingHour',primaryLabel:'ثبت ساعت کاری'},
  'delivery-hours':{referencePath:'/panel/settings/deliveryHour',primaryLabel:'ثبت ساعت تحویل'},
  shifts:{referencePath:'/panel/settings/servingTime',fields:[f('title','عنوان شیفت کاری','text',undefined,true),f('start','ساعت شروع شیفت','time',undefined,true),f('end','ساعت پایان شیفت','time',undefined,true),f('description','توضیحات','textarea',undefined,false,true)]},
  'online-menu':{referencePath:'/panel/settings/notices',primaryLabel:'ذخیره تنظیمات سایت و منو',toolbarActions:['دانلود کیوآر کد'],fields:[f('uniqueName','آدرس اختصاصی سایت'),f('analytics','کد آنالیتیکس'),f('enamad','کد اینماد'),f('minimumOrder','حداقل مبلغ خرید از سایت','number'),f('reservationLimit','محدودیت زمان رزرواسیون','number'),f('reservationFee','هزینه رزرو جایگاه','number'),f('dineIn','حضوری - داخل مجموعه','checkbox'),f('pickup','دریافت حضوری','checkbox'),f('courier','ارسال با پیک به آدرس انتخابی','checkbox'),f('gateway','درگاه پرداخت','checkbox'),f('payOnDelivery','پرداخت زمان تحویل','checkbox'),f('reservation','رزرو جایگاه','checkbox'),f('event','رزرو رویداد','checkbox'),f('staffCall','فراخوان پرسنل','checkbox'),f('split','پرداخت دُنگی','checkbox'),f('tip','پرداخت انعام','checkbox'),f('darkMode','قابلیت فعالسازی دارک مود','checkbox'),f('allergy','نمایش حساسیت غذایی','checkbox'),f('calorie','نمایش کالری محصول','checkbox'),f('greeting','نمایش پیام روز بخیر','checkbox'),f('autoApprove','تایید خودکار سفارش‌های آنلاین','checkbox'),f('closed','بستن موقت سایت','checkbox')]},
  'terminal-categories':{referencePath:'/panel/settings/terminalCategory',fields:[f('name','نام دسته‌بندی جایگاه','text',undefined,true),f('description','توضیحات','textarea',undefined,false,true)]},
  terminals:{referencePath:'/panel/settings/terminal',fields:[f('name','نام جایگاه','text',undefined,true),f('category','دسته‌بندی جایگاه','select',['سالن','تراس','بیرون‌بر']),f('priority','اولویت','number'),f('takeaway','جایگاه بیرون‌بر','checkbox'),f('sms','ارسال پیامک','checkbox'),f('description','توضیحات','textarea',undefined,false,true)],rowActions:['ویرایش','حذف']},
  couriers:{referencePath:'/panel/settings/postOfficer'},
  printers:{referencePath:'/panel/settings/printer',fields:[f('name','نام چاپگر','text',undefined,true),f('categories','انتخاب دسته‌بندی','select',['همه','کافی‌شاپ','رستوران']),f('products','انتخاب محصولات','select',['همه محصولات','انتخاب دستی']),f('description','توضیحات','textarea',undefined,false,true)],rowActions:['ویرایش','حذف']},
  funds:{referencePath:'/panel/settings/fund',fields:[f('name','نام صندوق','text',undefined,true),f('code','کد'),f('priority','اولویت','number'),f('terminal','شماره ترمینال دستگاه کارت‌خوان')],rowActions:['ویرایش','حذف']},
  scale:{referencePath:'/panel/settings/scale',primaryLabel:'ذخیره تنظیمات ترازو'},
  'delivery-zones':{referencePath:'/panel/settings/deliveryZone',fields:[f('title','عنوان محدوده','text',undefined,true),f('fee','هزینه ارسال در این محدوده (تومان)','number'),f('minutes','حداکثر زمان ارسال در این محدوده (دقیقه)','number'),f('showAll','نمایش همه محدوده‌ها','checkbox'),f('active','محدوده فعال است','checkbox')]},
  'billing-settings':{referencePath:'/panel/settings/billingSettings',primaryLabel:'ذخیره تنظیمات'},
  'general-info':{referencePath:'/panel/settings/generalInfo',primaryLabel:'ثبت مشخصات عمومی',fields:[f('logo','لوگوی مجموعه','file'),f('name','نام مجموعه','text',undefined,true),f('englishName','نام انگلیسی مجموعه'),f('phone','شماره تماس'),f('shopUrl','آدرس سایت'),f('instagram','آدرس اینستاگرام'),f('city','شهر','select',['تهران','شیراز','مشهد','اصفهان']),f('address','آدرس کامل','textarea',undefined,false,true),f('about','درباره برند','textarea',undefined,false,true)]},
  'base-info':{referencePath:'/panel/settings/baseInfo',primaryLabel:'ثبت اطلاعات پایه',fields:[f('vat','پیش‌فرض ارزش افزوده در تعریف محصولات','number'),f('serviceType','نوع حق سرویس','radio',['درصد','مبلغ']),f('serviceFee','حق سرویس','number'),f('invoiceStart','شروع شماره‌گذاری روزانه صورت‌حساب','number'),f('customerPrintCreate','تعداد پرینت مشتری بعد از ثبت صورت‌حساب','number'),f('customerPrintPay','تعداد پرینت مشتری بعد از پرداخت صورت‌حساب','number'),f('receipt','توضیحات زیر چاپ رسید','textarea',undefined,false,true),f('productionPrint','پرینت تولید بعد از پرداخت','checkbox')]},
  'external-systems':{referencePath:'/panel/settings/externalSystems',primaryLabel:'ثبت اطلاعات سیستم‌های خارجی',toolbarActions:['همگام سازی'],fields:[f('miareToken','توکن میاره'),f('alopeykToken','توکن الوپیک'),f('alopeykUser','نام کاربری الوپیک'),f('alopeykPassword','رمز عبور الوپیک'),f('alopeykStore','کد فروشگاه الوپیک'),f('snappBox','توکن اسنپ باکس'),f('airiaToken','توکن آیریا'),f('airiaWallet','کد کیف پول آیریا'),f('digipayUser','نام کاربری دیجی پی'),f('digipayPassword','رمز عبور دیجی پی'),f('digipayId','Id کاربری دیجی پی'),f('digipaySecret','Secret کاربری دیجی پی'),f('digipayBranch','کد شعبه دیجی پی'),f('taraUser','نام کاربری تارا'),f('taraPassword','رمز عبور تارا'),f('taraOfflineUser','نام کاربری تارا آفلاین'),f('taraOfflinePassword','رمز عبور تارا آفلاین'),f('taraBranch','کد شعبه تارا')]},
  'tax-info':{referencePath:'/panel/settings/taxInfo',primaryLabel:'ثبت اطلاعات مالیاتی'},
  localization:{referencePath:'/panel/settings/langConfigs',primaryLabel:'ثبت محلی‌سازی'},
  'sms-settings':{referencePath:'/panel/settings/message'},
  staff:{referencePath:'/panel/settings/StaffList',fields:[f('fullName','نام و نام خانوادگی','text',undefined,true),f('mobile','شماره تماس','text',undefined,true),f('code','کد پرسنلی'),f('role','نقش','select',['مدیر','حسابدار','صندوقدار','سوپروایزر','مدیر محصولات و سایت','پیک','کاربر ثبت سفارش','سایر'],true),f('birthDate','تاریخ تولد','date'),f('activityDate','تاریخ فعالیت','date'),f('start','ساعت شروع فعالیت','time'),f('end','ساعت پایان فعالیت','time'),f('session','زمان نشست','number'),f('guarantee','مبلغ ضمانت (تومان)','number'),f('address','آدرس','textarea',undefined,false,true),f('description','توضیحات','textarea',undefined,false,true)],rowActions:['ویرایش','حذف']},
  'notification-settings':{referencePath:'/panel/settings/notification',primaryLabel:'ذخیره تنظیمات',toolbarActions:['صدای پیش‌فرض']},
  sessions:{referencePath:'/panel/settings/allSessions',rowActions:['حذف نشست']},
  kiosk:{referencePath:'/panel/settings/kioskSetting'},
  tara:{referencePath:'/panel/taraSetting',primaryLabel:'ذخیره',toolbarActions:['همگام سازی']},
  upgrade:{referencePath:'/panel/extension-plan/MONTHLY',toolbarActions:['جزئیات و نحوه دریافت اعتبار','مقایسه اشتراک‌ها','خرید اشتراک']}
};

export const actionDialogs:Record<string,Record<string,FidelityDialog>>={
  wallet:{
    'کاهش موجودی مشتری':{title:'کاهش موجودی مشتری',submitLabel:'محاسبه',fields:[f('category','انتخاب دسته‌بندی','select',['همه','وفادار','جدید']),f('customers','انتخاب مشتریان','select',['همه مشتریان','انتخاب دستی'],true),f('amount','مبلغ کاهش (تومان)','number',undefined,true)]},
    'افزایش موجودی مشتری':{title:'افزایش موجودی مشتری',submitLabel:'محاسبه',fields:[f('category','انتخاب دسته‌بندی','select',['همه','وفادار','جدید']),f('customers','انتخاب مشتریان','select',['همه مشتریان','انتخاب دستی'],true),f('amount','مبلغ افزایش (تومان)','number',undefined,true),f('expiry','تاریخ انقضا','date')]}
  },
  'reservation-orders':{
    'رزرو دسته‌جمعی':{title:'رزرو دسته‌جمعی',submitLabel:'ثبت رزرو دسته‌جمعی',fields:[f('range','بازه تاریخ رزرو','date',undefined,true),f('meal','وعده غذایی','select',['صبحانه','ناهار','شام']),f('capacity','ظرفیت','number')]}
  },
  'stock-report':{
    'پیشنهاد خرید مواد اولیه':{title:'پیشنهاد خرید مواد اولیه',submitLabel:'ثبت به‌عنوان فاکتور ورودی انبار',description:'اقلام زیر بر اساس نقطه سفارش و موجودی فعلی پیشنهاد شده‌اند.',fields:[f('warehouse','انبار مقصد','select',['انبار اصلی','انبار آشپزخانه'],true),f('supplier','تأمین‌کننده','select',['بازار مرکزی','تأمین‌کننده عمومی']),f('date','تاریخ','date',undefined,true)]}
  },
  finance:{
    'ثبت پرداخت':{title:'ثبت پرداخت',submitLabel:'ثبت',fields:[f('date','تاریخ','date',undefined,true),f('fund','برداشت از صندوق','select',['صندوق کارت‌خوان','صندوق نقدی'],true),f('person','نام یا شماره همراه'),f('amount','مبلغ (تومان)','number',undefined,true),f('subject','بابت','textarea',undefined,true,true)]},
    'ثبت دریافت':{title:'ثبت دریافت',submitLabel:'ثبت',fields:[f('date','تاریخ','date',undefined,true),f('fund','انتقال به صندوق','select',['صندوق کارت‌خوان','صندوق نقدی'],true),f('person','نام یا شماره همراه'),f('amount','مبلغ (تومان)','number',undefined,true),f('subject','بابت','textarea',undefined,true,true)]}
  },
  materials:{
    'انتخاب از لیست پیش‌فرض':{title:'انتخاب مواد اولیه از فهرست پیش‌فرض',submitLabel:'افزودن اقلام انتخاب‌شده',fields:[f('category','دسته‌بندی','select',['نوشیدنی','پروتئین','خشکبار','لبنیات']),f('items','مواد اولیه','select',['آرد','روغن','شیر','قهوه','گوشت','پنیر'],true)]}
  }
};

export const referenceMainOrder=['dashboard','menu','open-bills','bill-list','crm','campaign','survey','inventory','reservations','kds','settings','upgrade'];
