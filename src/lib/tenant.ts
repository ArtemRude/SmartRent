export function normalizeTenantEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateTenantDetails(name: string, email: string) {
  if (!name.trim()) return "Укажите имя арендатора";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeTenantEmail(email))) {
    return "Укажите корректный email";
  }
  return null;
}
