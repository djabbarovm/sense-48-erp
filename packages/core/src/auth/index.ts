export * from './jwt.js';
export * from './password.js';

/** ADR-002: абстракция провайдера аутентификации (dev JWT ↔ Supabase). */
export interface AuthProvider {
  verifyToken(token: string): Promise<{ userId: string; email: string } | null>;
}
