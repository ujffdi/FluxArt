export function addCreditValidityWindow(date: Date) {
  const targetYear = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + 1;
  const targetLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCFullYear(targetYear, targetMonth, Math.min(date.getUTCDate(), targetLastDay));
  return result;
}

export function creditValidUntilIso(date = new Date()) {
  return addCreditValidityWindow(date).toISOString();
}
