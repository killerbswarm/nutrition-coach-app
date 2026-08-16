/**
 * Payroll should only count nutrition-coaching dollars, not retail
 * (punch cards, pre-workout, merch, etc.).
 *
 * Prefer explicit fields when present:
 *   tx.payrollAmount  — manual override
 *   tx.lineItems[]    — { name, price|amount, qty? } from Stax/email parse
 * Else fall back to tx.amount, but if package text mixes retail + nutrition
 * and we cannot split, still use full amount (edit txn to fix).
 */

const NUTRITION_RE =
  /\b(nutrition|coaching|coach(ing)?|phase\s*\d|cycle|ongoing\s*(plan|membership)?|standard\s*nutrition|initial\s*3[- ]?cycle)\b/i;

const RETAIL_RE =
  /\b(punch\s*card|digital\s*punch|pre[-\s]?work(out)?|drink|shake|merch(andise)?|apparel|t-?shirt|hoodie|supplement(?!\s*coach)|retail|drop[\s-]?in|day\s*pass)\b/i;

function itemPrice(item) {
  if (!item || typeof item !== 'object') return 0;
  const raw =
    item.price ??
    item.amount ??
    item.total ??
    item.lineTotal ??
    item.unitPrice;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const n = parseFloat(raw.replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function itemQty(item) {
  const q = Number(item?.qty ?? item?.quantity ?? 1);
  return q > 0 ? q : 1;
}

function isNutritionItem(name) {
  const s = String(name || '');
  if (RETAIL_RE.test(s) && !NUTRITION_RE.test(s)) return false;
  if (NUTRITION_RE.test(s)) return true;
  return false;
}

function isRetailItem(name) {
  const s = String(name || '');
  if (NUTRITION_RE.test(s) && !RETAIL_RE.test(s)) return false;
  return RETAIL_RE.test(s);
}

/**
 * Amount that should drive coach/staff payroll for this transaction.
 */
export function getPayrollAmount(tx) {
  if (!tx) return 0;

  // Manual override (edit in Run Payroll / Firestore)
  if (tx.payrollAmount != null && tx.payrollAmount !== '') {
    const n = Number(tx.payrollAmount);
    if (!isNaN(n)) return n;
  }

  const lineItems = Array.isArray(tx.lineItems) ? tx.lineItems : null;
  if (lineItems && lineItems.length > 0) {
    let nutritionSum = 0;
    let retailSum = 0;
    let otherSum = 0;
    for (const item of lineItems) {
      const name = item.name || item.title || item.description || '';
      const line = itemPrice(item) * itemQty(item);
      if (isNutritionItem(name)) nutritionSum += line;
      else if (isRetailItem(name)) retailSum += line;
      else otherSum += line;
    }
    // If we found nutrition lines, use only those
    if (nutritionSum > 0) {
      return Math.round(nutritionSum * 100) / 100;
    }
    // All retail → $0 toward coach pay
    if (retailSum > 0 && otherSum === 0) {
      return 0;
    }
  }

  // Package string like "Digital PunchCard, Pre Workout, Standard Nutrition Coaching"
  const pkg = String(tx.package || '');
  if (pkg && RETAIL_RE.test(pkg) && NUTRITION_RE.test(pkg)) {
    // Mixed cart without line item prices — cannot split safely.
    // Prefer payrollAmount override; otherwise keep full amount but callers
    // can surface a warning via isMixedRetailPackage(tx).
  }

  return Number(tx.amount) || 0;
}

export function isMixedRetailPackage(tx) {
  const pkg = String(tx?.package || '');
  const hasLines = Array.isArray(tx?.lineItems) && tx.lineItems.length > 0;
  if (hasLines) {
    let hasN = false;
    let hasR = false;
    for (const item of tx.lineItems) {
      const name = item.name || item.title || '';
      if (isNutritionItem(name)) hasN = true;
      if (isRetailItem(name)) hasR = true;
    }
    return hasN && hasR;
  }
  return RETAIL_RE.test(pkg) && NUTRITION_RE.test(pkg);
}

export { NUTRITION_RE, RETAIL_RE };