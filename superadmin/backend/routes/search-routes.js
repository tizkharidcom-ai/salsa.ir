// server/salsa/control-plane/routes/search-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const { authenticatePlatform } = require('../auth/auth-middleware');
const { getDatabase } = require('../db/database');

// Authenticated Endpoints
router.use(authenticatePlatform);

const NAVIGATION_ITEMS = [
  { id: 'nav_home', type: 'navigation', category: 'ناوبری', title: 'خانه — مرکز کار و عملیات', subtitle: 'پیشخوان اصلی و کارتابل کارهای فوری', badge: 'صفحه', hash: '#home', keywords: ['خانه', 'home', 'overview', 'پیشخوان', 'داشبورد'] },
  { id: 'nav_restaurants', type: 'navigation', category: 'ناوبری', title: 'فهرست مجموعه‌ها و رستوران‌ها', subtitle: 'مدیریت مشتریان سازمانی، شعب و وضعیت سرویس', badge: 'صفحه', hash: '#restaurants', keywords: ['رستوران', 'مجموعه', 'شعبه', 'restaurants', 'tenants', 'مشتریان'] },
  { id: 'nav_restaurant_new', type: 'navigation', category: 'ناوبری', title: 'ایجاد مجموعه جدید', subtitle: 'ویزارد ۳ مرحله‌ای راه‌اندازی و ثبت شناسه یکتا', badge: 'اقدام', hash: '#restaurants/new', keywords: ['جدید', 'ایجاد', 'ثبت نام', 'new', 'create', 'onboarding'] },
  { id: 'nav_commercial_plans', type: 'navigation', category: 'ناوبری', title: 'پلن‌ها و تعرفه‌ها', subtitle: 'مدیریت بسته‌های اشتراک، قیمت‌ها و سهمیه‌ها', badge: 'صفحه', hash: '#commercial?section=plans', keywords: ['پلن', 'تعرفه', 'قیمت', 'plans', 'pricing', 'بسته'] },
  { id: 'nav_commercial_billing', type: 'navigation', category: 'ناوبری', title: 'صورتحساب‌ها و مالی', subtitle: 'مدیریت فاکتورها، انطباق با سامانه مودیان و وصول', badge: 'صفحه', hash: '#commercial?section=billing', keywords: ['فاکتور', 'مالی', 'صورتحساب', 'مودیان', 'مالیات', 'billing', 'invoices'] },
  { id: 'nav_operations_inbox', type: 'navigation', category: 'ناوبری', title: 'کارتابل هشدارهای عملیاتی', subtitle: 'رسیدگی به رخدادها، جاب‌های شکست‌خورده و خطاهای زیرساخت', badge: 'صفحه', hash: '#operations?section=inbox', keywords: ['هشدار', 'خطا', 'رخداد', 'حادثه', 'inbox', 'alerts', 'incidents'] },
  { id: 'nav_operations_infra', type: 'navigation', category: 'ناوبری', title: 'تله‌متری و پروب‌های زیرساخت', subtitle: 'پایش زنده‌ی سلامت دیتابیس، کش و پل رانتایم', badge: 'صفحه', hash: '#operations?section=infra', keywords: ['زیرساخت', 'پروب', 'تله‌متری', 'سرور', 'infra', 'probes', 'telemetry'] },
  { id: 'nav_operations_releases', type: 'navigation', category: 'ناوبری', title: 'انتشار نسخه و رول‌بک', subtitle: 'کاناری رول‌اوت و مدیریت نسخه‌های کلاینت و سرور', badge: 'صفحه', hash: '#operations?section=releases', keywords: ['انتشار', 'نسخه', 'ورژن', 'releases', 'deploy', 'rollback'] },
  { id: 'nav_settings_team', type: 'navigation', category: 'ناوبری', title: 'مدیریت تیم سالسا', subtitle: 'حساب‌های کاربری راهبران، نقش‌ها و نشست‌های فعال', badge: 'صفحه', hash: '#settings?section=team', keywords: ['تیم', 'کاربران', 'راهبر', 'ادمین', 'team', 'users', 'principals'] },
  { id: 'nav_settings_security', type: 'navigation', category: 'ناوبری', title: 'سپر امنیتی و گواهی TLS', subtitle: 'پایش ۱۰ دروازه امنیتی، پروتکل TLS 1.3 و مانور قرنطینه', badge: 'صفحه', hash: '#settings?section=security', keywords: ['امنیت', 'سپر', 'tls', 'ssl', 'گواهی', 'security', 'lockdown'] },
  { id: 'nav_settings_audit', type: 'navigation', category: 'ناوبری', title: 'ردپای ممیزی (Audit Trail)', subtitle: 'زنجیره هش غیرقابل‌تغییر SHA-256 و لاگ کلیه تغییرات', badge: 'صفحه', hash: '#settings?section=audit', keywords: ['ممیزی', 'لاگ', 'ردپا', 'audit', 'logs', 'sha256'] },
  { id: 'nav_settings_hardware', type: 'navigation', category: 'ناوبری', title: 'کاتالوگ مدل‌های سخت‌افزار', subtitle: 'دستگاه‌ها و چاپگرهای دارای تاییدیه رسمی سالسا', badge: 'صفحه', hash: '#settings?section=hardware', keywords: ['سخت‌افزار', 'پرینتر', 'چاپگر', 'پوز', 'hardware', 'printers'] }
];

/**
 * GET /api/control/search
 * Global backend search across restaurants, invoices, devices, jobs & navigation.
 */
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const categoryFilter = req.query.category || 'all';

    if (!q || q.length < 2) {
      return res.json({
        ok: true,
        success: true,
        data: {
          query: q,
          total: 0,
          results: []
        }
      });
    }

    const term = `%${q}%`;
    const lowerQuery = q.toLowerCase();
    const results = [];
    const db = getDatabase();

    // 1. Navigation items search
    if (categoryFilter === 'all' || categoryFilter === 'navigation') {
      for (const item of NAVIGATION_ITEMS) {
        if (
          item.title.toLowerCase().includes(lowerQuery) ||
          item.subtitle.toLowerCase().includes(lowerQuery) ||
          item.keywords.some(k => k.toLowerCase().includes(lowerQuery))
        ) {
          results.push({
            id: item.id,
            type: 'navigation',
            category: 'ناوبری پلتفرم',
            title: item.title,
            subtitle: item.subtitle,
            badge: item.badge,
            hash: item.hash
          });
        }
      }
    }

    // 2. Search Restaurants
    if (categoryFilter === 'all' || categoryFilter === 'restaurants') {
      try {
        const tenantRes = await db.query(
          `SELECT id, name, slug, status, plan, created_at
           FROM neem_tenants
           WHERE id ILIKE $1 OR name ILIKE $1 OR slug ILIKE $1
           LIMIT $2`,
          [term, limit]
        );
        const tenants = tenantRes.rows || [];
        for (const t of tenants) {
          results.push({
            id: `tenant_${t.id}`,
            type: 'restaurant',
            category: 'رستوران‌ها',
            title: t.name,
            subtitle: `شناسه: ${t.id} ${t.plan ? '— پلن ' + t.plan : ''}`,
            badge: t.status === 'active' ? 'فعال' : (t.status === 'suspended' ? 'معلق' : 'در مهلت'),
            hash: `#restaurants/workspace?id=${encodeURIComponent(t.id)}`
          });
        }
      } catch (_) {}
    }

    // 3. Search Invoices
    if (categoryFilter === 'all' || categoryFilter === 'invoices') {
      try {
        const invRes = await db.query(
          `SELECT id, tenant_id, total_amount_rials, status, due_date
           FROM neem_invoices
           WHERE id ILIKE $1 OR tenant_id ILIKE $1
           LIMIT $2`,
          [term, limit]
        );
        const invoices = invRes.rows || [];
        for (const inv of invoices) {
          const toman = Math.round((inv.total_amount_rials || 0) / 10);
          results.push({
            id: `inv_${inv.id}`,
            type: 'invoice',
            category: 'مالی و فاکتورها',
            title: `فاکتور ${inv.id}`,
            subtitle: `مجموعه: ${inv.tenant_id} — مبلغ: ${toman.toLocaleString('fa-IR')} تومان`,
            badge: inv.status === 'paid' ? 'تسویه' : (inv.status === 'overdue' ? 'سررسیدشده' : 'در انتظار'),
            hash: `#commercial?section=billing&invoiceId=${encodeURIComponent(inv.id)}`
          });
        }
      } catch (_) {}
    }

    // 4. Search Devices & Hardware
    if (categoryFilter === 'all' || categoryFilter === 'devices') {
      try {
        const devRes = await db.query(
          `SELECT id, tenant_id, device_name, device_type, mac_address, status
           FROM neem_devices
           WHERE id ILIKE $1 OR device_name ILIKE $1 OR tenant_id ILIKE $1 OR mac_address ILIKE $1
           LIMIT $2`,
          [term, limit]
        );
        const devices = devRes.rows || [];
        for (const d of devices) {
          results.push({
            id: `dev_${d.id}`,
            type: 'device',
            category: 'سخت‌افزار و شعب',
            title: d.device_name || `دستگاه ${d.id}`,
            subtitle: `نوع: ${d.device_type || 'پوز'} — مجموعه: ${d.tenant_id}`,
            badge: d.status === 'online' ? 'آنلاین' : 'آفلاین',
            hash: `#restaurants/workspace?id=${encodeURIComponent(d.tenant_id)}&tab=hardware`
          });
        }
      } catch (_) {}
    }

    // 5. Search Provisioning Jobs
    if (categoryFilter === 'all' || categoryFilter === 'jobs') {
      try {
        const jobsRes = await db.query(
          `SELECT id, tenant_id, status, error
           FROM neem_provisioning_jobs
           WHERE id ILIKE $1 OR tenant_id ILIKE $1
           LIMIT $2`,
          [term, limit]
        );
        const jobs = jobsRes.rows || [];
        for (const j of jobs) {
          results.push({
            id: `job_${j.id}`,
            type: 'job',
            category: 'عملیات و جاب‌ها',
            title: `جاب راه‌اندازی ${j.id}`,
            subtitle: `مجموعه: ${j.tenant_id}`,
            badge: j.status === 'succeeded' ? 'موفق' : (j.status === 'failed' ? 'شکست‌خورده' : 'در حال اجرا'),
            hash: `#operations?section=jobs&jobId=${encodeURIComponent(j.id)}`
          });
        }
      } catch (_) {}
    }

    return res.json({
      ok: true,
      success: true,
      data: {
        query: q,
        total: results.length,
        results: results.slice(0, limit)
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

module.exports = router;
