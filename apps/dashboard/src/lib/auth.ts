import type { AccountInfo } from '@azure/msal-browser';
import { ALLOWED_ROLES } from './msal-config';

export const getRolesFromAccount = (account: AccountInfo | null): string[] => {
  if (!account?.idTokenClaims) return [];
  const claims = account.idTokenClaims as Record<string, unknown>;
  const roles = claims['roles'];
  return Array.isArray(roles) ? (roles as string[]) : [];
};

export const hasAllowedRole = (account: AccountInfo | null): boolean => {
  const roles = getRolesFromAccount(account);
  return (ALLOWED_ROLES as readonly string[]).some((r) => roles.includes(r));
};
