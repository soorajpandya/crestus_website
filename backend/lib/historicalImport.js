// Imported wallet deposits are audit records. Website payment/shipping actions must not run.
function isHistoricalImport(order) {
  return order?.record_kind === 'historical_wallet_deposit' || order?.import_metadata?.side_effects_disabled === true;
}
function requireOperationalOrder(order) {
  if (isHistoricalImport(order)) {
    const error = new Error('Historical import is read-only. Payment and shipping actions are disabled.');
    error.status = 409;
    throw error;
  }
}
module.exports = {isHistoricalImport, requireOperationalOrder};
