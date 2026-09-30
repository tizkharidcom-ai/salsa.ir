'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/roles/matrix', __westoModuleContext.requireAdmin, (req, res) => {
  const matrix = {
    roles: [
      { id: 'owner', label: 'مالک / مدیر ارشد', category: 'staff', description: 'دسترسی نامحدود به تمامی بخش‌ها، تنظیمات، اسناد مالی و حذف کاربران', icon: '👑', badgeClass: 'role-owner' },
      { id: 'manager', label: 'مدیر داخلی / سرپرست', category: 'staff', description: 'مدیریت عملیات، سفارش‌ها، رزروها، صندوق، آشپزخانه، انبار، پرسنل و گزارش‌ها', icon: '🧑‍💼', badgeClass: 'role-manager' },
      { id: 'accountant', label: 'حسابدار / مدیر مالی', category: 'staff', description: 'اسناد دوبل، ترازنامه، صورت سود و زیان، بستن دوره‌های مالی و مغایرت‌گیری', icon: '💰', badgeClass: 'role-accountant' },
      { id: 'cashier', label: 'صندوقدار / صندوق', category: 'staff', description: 'ثبت سفارش، تسویه فاکتور، مدیریت پوز و وجه نقد، رزرو و وضعیت تحویل', icon: '💵', badgeClass: 'role-cashier' },
      { id: 'waiter', label: 'گارسون / سالن‌کار', category: 'staff', description: 'سفارش‌گیری سر میز با تبلت، فراخوانی مهمان، وضعیت میزها و سرو', icon: '🤵', badgeClass: 'role-waiter' },
      { id: 'kitchen', label: 'آشپزخانه / سرآشپز', category: 'staff', description: 'مشاهده صفحه KDS، مدیریت صف پخت، اعلام آماده بودن و ثبت حواله مصرف انبار', icon: '🍳', badgeClass: 'role-kitchen' },
      { id: 'guest', label: 'مشتری / مهمان', category: 'customer', description: 'ثبت سفارش، رزرو آنلاین، باشگاه مشتریان، کیف پول و ثبت بازخورد', icon: '🌟', badgeClass: 'role-guest' },
    ],
    sections: [
      {
        id: 'orders',
        title: 'سفارش‌ها و صندوق',
        description: 'مشاهده، ثبت و مدیریت سفارش‌های حضوری و آنلاین، تسویه فاکتور',
        roles: { owner: 'full', manager: 'full', cashier: 'full', waiter: 'create_view', kitchen: 'none', accountant: 'none', guest: 'self_only' },
      },
      {
        id: 'kitchen',
        title: 'صف آشپزخانه (KDS)',
        description: 'مشاهده کارت‌های پخت، شروع آماده‌سازی و تغییر به وضعیت آماده',
        roles: { owner: 'full', manager: 'full', kitchen: 'full', cashier: 'none', waiter: 'none', accountant: 'none', guest: 'none' },
      },
      {
        id: 'tables',
        title: 'میزها و سالن پذیرایی',
        description: 'نقشه میزها، اعلام درخواست گارسون و مدیریت ظرفیت سالن',
        roles: { owner: 'full', manager: 'full', waiter: 'full', cashier: 'full', kitchen: 'none', accountant: 'none', guest: 'call_only' },
      },
      {
        id: 'finance',
        title: 'مالی و حسابداری',
        description: 'اسناد دوبل حسابداری، بستن دوره‌ها، مغایرت‌گیری و ترازنامه',
        roles: { owner: 'full', manager: 'full', accountant: 'full', cashier: 'cash_only', waiter: 'none', kitchen: 'none', guest: 'none' },
      },
      {
        id: 'inventory',
        title: 'انبار و مواد اولیه',
        description: 'موجودی انبار، ورود کالا (رسید)، حواله مصرف و بهای تمام‌شده',
        roles: { owner: 'full', manager: 'full', accountant: 'view_only', kitchen: 'operations_only', cashier: 'none', waiter: 'none', guest: 'none' },
      },
      {
        id: 'menu',
        title: 'منو، قیمت‌ها و محصولات',
        description: 'ویرایش غذاها و محصولات، دسته‌بندی‌ها، قیمت‌گذاری و فعال/غیرفعال کردن',
        roles: { owner: 'full', manager: 'full', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' },
      },
      {
        id: 'reports',
        title: 'گزارش‌های فروش و آمار',
        description: 'تحلیل روزانه و ماهانه، نمودارهای سودآوری و ترافیک مهمان',
        roles: { owner: 'full', manager: 'full', accountant: 'full', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' },
      },
      {
        id: 'club',
        title: 'باشگاه مشتریان و پیامک',
        description: 'مدیریت اعضای وفادار، سطوح برنزی تا طلایی، کیف پول و کمپین‌ها',
        roles: { owner: 'full', manager: 'full', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'profile_only' },
      },
      {
        id: 'settings',
        title: 'تنظیمات و دسترسی کاربران',
        description: 'مدیریت کاربران، تغییر نقش‌ها، تخصیص شعب و پیکربندی سیستم',
        roles: { owner: 'full', manager: 'view_manage', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' },
      },
    ],
    capabilities: __westoModuleContext.ROLE_CAPABILITIES,
  };
  res.json(matrix);
});
};
