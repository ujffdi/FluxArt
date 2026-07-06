export const oneMonthCreditValidityDays = 30;

export function addCreditValidityWindow(date: Date, days = oneMonthCreditValidityDays) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function creditValidUntilIso(date = new Date()) {
  return addCreditValidityWindow(date).toISOString();
}
