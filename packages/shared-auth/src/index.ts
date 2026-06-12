import type { AccountInfo } from '@azure/msal-browser';
import type { UserRole } from '@mat-inspect/shared-types';

// Reads the Entra app roles from an MSAL account's id token claims. Returns []
// for a null account, an account with no claims, or a roles claim that is not an
// array. Entra emits the roles claim as lowercase app role values.
export const getRolesFromAccount = (account: AccountInfo | null): string[] => {
  if (!account?.idTokenClaims) return [];
  const claims = account.idTokenClaims as Record<string, unknown>;
  const roles = claims['roles'];
  return Array.isArray(roles) ? (roles as string[]) : [];
};

// True when the account holds at least one role in allowedRoles. Each app passes
// its own ALLOWED_ROLES (PWA: operator, supervisor; dashboard: supervisor,
// manager, admin). Values are lowercase to match the Entra app role values, so the
// comparison is a plain case-sensitive match (see shared-types UserRole).
export const hasAllowedRole = (
  account: AccountInfo | null,
  allowedRoles: readonly UserRole[],
): boolean => {
  const roles = getRolesFromAccount(account);
  return allowedRoles.some((r) => roles.includes(r));
};
