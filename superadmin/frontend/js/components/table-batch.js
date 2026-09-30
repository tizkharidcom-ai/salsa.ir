// prototype/js/components/table-batch.js
// Table Collection & Bulk Selection Controller
'use strict';

const GMTableSelect = {
  instances: new Map(),
  activeInstance: null,

  initTable(tableSelector, options = {}) {
    const table = typeof tableSelector === 'string' ? document.querySelector(tableSelector) : tableSelector;
    if (!table) return null;

    const selectAllSelector = options.selectAllSelector || (options.selectAllId ? (options.selectAllId.startsWith('#') ? options.selectAllId : '#' + options.selectAllId) : null);
    const selectAllEl = selectAllSelector ? document.querySelector(selectAllSelector) : table.querySelector('thead input[type="checkbox"]');

    const rowSelector = options.rowCheckboxSelector || (options.rowCheckboxClass ? (options.rowCheckboxClass.startsWith('.') ? options.rowCheckboxClass : '.' + options.rowCheckboxClass) : 'tbody tr input[type="checkbox"]');

    const rawBulkId = options.bulkBarId ? options.bulkBarId.replace(/^#/, '') : null;
    const bulkBar = options.bulkBar || (rawBulkId ? (typeof document !== 'undefined' && document.getElementById ? (document.getElementById(rawBulkId) || (document.querySelector && document.querySelector('#' + rawBulkId))) : null) : null);

    const rawCountId = options.countBadgeId ? options.countBadgeId.replace(/^#/, '') : null;
    const countBadge = options.countBadge ||
      (rawCountId ? (typeof document !== 'undefined' && document.getElementById ? (document.getElementById(rawCountId) || (document.querySelector && document.querySelector('#' + rawCountId))) : null) : null) ||
      (options.selectedCountClass ? (bulkBar && bulkBar.querySelector ? bulkBar.querySelector(options.selectedCountClass) : (typeof document !== 'undefined' && document.querySelector ? document.querySelector(options.selectedCountClass) : null)) : null) ||
      (bulkBar && bulkBar.querySelector ? (bulkBar.querySelector('.bulk-counter-badge') || bulkBar.querySelector('.bulk-selected-count')) : null);

    const instance = {
      table,
      selectAllEl,
      rowSelector,
      bulkBar,
      countBadge,
      options,

      getSelectedIds() {
        const checkedBoxes = Array.from(table.querySelectorAll(rowSelector + ':checked'));
        return checkedBoxes.map(cb => {
          const row = cb.closest('tr');
          return cb.getAttribute('data-id') || (row ? row.getAttribute('data-id') : null) || cb.value;
        }).filter(Boolean);
      },

      getSelectedRows() {
        return Array.from(table.querySelectorAll(rowSelector + ':checked')).map(cb => cb.closest('tr')).filter(Boolean);
      },

      getSelectedItems() {
        const checkedBoxes = Array.from(table.querySelectorAll(rowSelector + ':checked'));
        return checkedBoxes.map(cb => {
          const row = cb.closest('tr');
          return {
            id: cb.getAttribute('data-id') || (row ? row.getAttribute('data-id') : null) || cb.value,
            status: cb.getAttribute('data-status') || (row ? row.getAttribute('data-status') : null),
            checkbox: cb,
            row: row
          };
        });
      },

      clear() {
        const checkboxes = table.querySelectorAll(rowSelector);
        checkboxes.forEach(cb => {
          cb.checked = false;
          const tr = cb.closest('tr');
          if (tr) tr.classList.remove('selected-row');
        });
        if (selectAllEl) {
          selectAllEl.checked = false;
          selectAllEl.indeterminate = false;
        }
        if (bulkBar) {
          bulkBar.classList.remove('is-visible');
          if (bulkBar.classList && typeof bulkBar.classList.contains === 'function' && bulkBar.classList.contains('bulk-actions-docked')) {
            bulkBar.style.display = 'none';
          }
          const actionBtns = bulkBar.querySelectorAll('button:not(.bulk-clear-btn), .btn:not(.bulk-clear-btn)');
          actionBtns.forEach(btn => {
            btn.disabled = true;
            btn.setAttribute('disabled', 'true');
          });
        }
        if (window.GMTableSelect.activeInstance === this) {
          window.GMTableSelect.activeInstance = null;
        }
        if (typeof options.onSelectionChange === 'function') {
          options.onSelectionChange([], [], []);
        }
      },

      clearSelection() {
        return this.clear();
      },

      sync() {
        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(r => !r.id || !r.id.includes('empty'));
        let visibleCount = 0;
        let visibleSelectedCount = 0;
        let totalSelectedCount = 0;

        rows.forEach(r => {
          const cb = r.querySelector(rowSelector);
          if (!cb) return;
          const isVisible = r.style.display !== 'none';
          if (isVisible) visibleCount++;

          if (cb.checked) {
            totalSelectedCount++;
            r.classList.add('selected-row');
            if (isVisible) visibleSelectedCount++;
          } else {
            r.classList.remove('selected-row');
          }
        });

        if (selectAllEl) {
          if (visibleCount === 0 || visibleSelectedCount === 0) {
            selectAllEl.checked = false;
            selectAllEl.indeterminate = false;
          } else if (visibleSelectedCount === visibleCount) {
            selectAllEl.checked = true;
            selectAllEl.indeterminate = false;
          } else {
            selectAllEl.checked = false;
            selectAllEl.indeterminate = true;
          }
        }

        if (bulkBar) {
          const actionBtns = bulkBar.querySelectorAll('button:not(.bulk-clear-btn), .btn:not(.bulk-clear-btn)');
          actionBtns.forEach(btn => {
            if (totalSelectedCount > 0) {
              btn.disabled = false;
              btn.removeAttribute('disabled');
            } else {
              btn.disabled = true;
              btn.setAttribute('disabled', 'true');
            }
          });

          if (totalSelectedCount > 0) {
            bulkBar.classList.add('is-visible');
            if (bulkBar.style && bulkBar.style.display === 'none') {
              bulkBar.style.display = '';
            }
            window.GMTableSelect.activeInstance = instance;
          } else {
            bulkBar.classList.remove('is-visible');
            if (bulkBar.classList && typeof bulkBar.classList.contains === 'function' && bulkBar.classList.contains('bulk-actions-docked')) {
              bulkBar.style.display = 'none';
            }
            if (window.GMTableSelect.activeInstance === instance) {
              window.GMTableSelect.activeInstance = null;
            }
          }
        }

        if (countBadge) {
          countBadge.textContent = `${totalSelectedCount.toLocaleString('fa-IR')} مورد انتخاب‌شده`;
        }

        if (typeof options.onSelectionChange === 'function') {
          const selectedIds = this.getSelectedIds();
          const selectedRows = this.getSelectedRows();
          options.onSelectionChange(selectedIds, selectedRows, this.getSelectedItems());
        }
      }
    };

    // Attach master selectAll listener
    if (selectAllEl) {
      selectAllEl.onchange = (e) => {
        const shouldCheck = e.target.checked;
        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(r => !r.id || !r.id.includes('empty'));
        rows.forEach(r => {
          if (r.style.display !== 'none') {
            const cb = r.querySelector(rowSelector);
            if (cb) {
              cb.checked = shouldCheck;
              if (shouldCheck) r.classList.add('selected-row');
              else r.classList.remove('selected-row');
            }
          }
        });
        instance.sync();
      };
    }

    // Attach row change listener
    table.addEventListener('change', (e) => {
      if (e.target.matches(rowSelector)) {
        const tr = e.target.closest('tr');
        if (tr) {
          if (e.target.checked) tr.classList.add('selected-row');
          else tr.classList.remove('selected-row');
        }
        instance.sync();
      }
    });

    // Clear buttons inside bulkBar
    if (bulkBar) {
      const clearBtn = bulkBar.querySelector('.bulk-clear-btn');
      if (clearBtn) {
        clearBtn.onclick = () => instance.clear();
      }
      // Initialize action buttons as disabled
      const actionBtns = bulkBar.querySelectorAll('button:not(.bulk-clear-btn), .btn:not(.bulk-clear-btn)');
      actionBtns.forEach(btn => {
        btn.disabled = true;
        btn.setAttribute('disabled', 'true');
      });
    }

    this.instances.set(table, instance);
    return instance;
  },

  clearActive() {
    if (this.activeInstance) {
      this.activeInstance.clear();
      this.activeInstance = null;
      return true;
    }
    return false;
  }
};

if (typeof window !== 'undefined') {
  window.GMTableSelect = GMTableSelect;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GMTableSelect;
  module.exports.GMTableSelect = GMTableSelect;
}
