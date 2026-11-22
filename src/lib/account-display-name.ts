export function accountDisplayName(name: string | null | undefined, email: string | null | undefined): string {
  return name?.trim() || email?.trim() || "My account";
}
