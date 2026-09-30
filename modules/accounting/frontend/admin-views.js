/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:expenses*/
window.WestoAdminModules.defineView('accounting', 'expenses', function(__westoViewContext) {
return {
async expenses() {
      __westoViewContext.setActiveTab('expenses');
      if (typeof window.renderAccountingWorkspace === 'function') {
        await window.renderAccountingWorkspace(__westoViewContext.main, __westoViewContext.branchQs(), {
          workspace: 'purchases',
          hasCapability: /*westo-module-shorthand*/ __westoViewContext.hasCapability,
          currentUser: () => __westoViewContext.currentUser,
          branchCount: () => __westoViewContext.branchesCache.length,
        });
      }
    }
}['expenses'];
});
/*westo-view:end:expenses*/

/*westo-view:start:finance*/
window.WestoAdminModules.defineView('accounting', 'finance', function(__westoViewContext) {
return {
async finance() {
      return __westoViewContext.tabs.accounting();
    }
}['finance'];
});
/*westo-view:end:finance*/

/*westo-view:start:accounting*/
window.WestoAdminModules.defineView('accounting', 'accounting', function(__westoViewContext) {
return {
async accounting() {
      __westoViewContext.setActiveTab('accounting');
      if (typeof window.renderAccountingWorkspace === 'function') {
        await window.renderAccountingWorkspace(__westoViewContext.main, __westoViewContext.branchQs(), {
          experience: 'accounting',
          hasCapability: /*westo-module-shorthand*/ __westoViewContext.hasCapability,
          currentUser: () => __westoViewContext.currentUser,
          // Finance renders its active scope in the header; pass the same
          // canonical branch cache used by the shell so multi-branch users
          // never lose the selected branch context in the accounting view.
          branchCount: () => __westoViewContext.branchesCache.length,
        });
      } else {
        __westoViewContext.main.innerHTML = '<h1>حسابداری</h1><p class="lead">ماژول حسابداری در حال بارگذاری…</p>';
      }
    }
}['accounting'];
});
/*westo-view:end:accounting*/
