BEGIN;

CREATE OR REPLACE FUNCTION finance_goods_receipt_immutable_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'goods_receipts_are_immutable_use_reversal';
END;
$$;

DROP TRIGGER IF EXISTS finance_goods_receipt_immutable_trigger ON finance_goods_receipts;
CREATE TRIGGER finance_goods_receipt_immutable_trigger
  BEFORE UPDATE OR DELETE ON finance_goods_receipts
  FOR EACH ROW EXECUTE FUNCTION finance_goods_receipt_immutable_guard();

CREATE OR REPLACE FUNCTION finance_vendor_invoice_immutable_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'vendor_invoices_are_immutable_use_reversal';
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number
    OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id
    OR NEW.total_irr IS DISTINCT FROM OLD.total_irr
    OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date THEN
    RAISE EXCEPTION 'vendor_invoice_financial_fields_are_immutable_use_reversal';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_vendor_invoice_immutable_trigger ON finance_vendor_invoices;
CREATE TRIGGER finance_vendor_invoice_immutable_trigger
  BEFORE UPDATE OR DELETE ON finance_vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION finance_vendor_invoice_immutable_guard();

COMMIT;
