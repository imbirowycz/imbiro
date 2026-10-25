export interface AdminUser {
  username: string
  email: string | null
}

/** Odpowiedź z POST /api/auth/login i GET /api/auth/me. */
export interface AuthSessionInfo {
  user: AdminUser
  /** Do odesłania w nagłówku X-CSRF-Token przy operacjach zmieniających stan. */
  csrfToken: string
  /** ISO — bezwzględny koniec sesji. */
  expiresAt: string
}

export interface LoginDTO {
  /** Login albo e-mail administratora. */
  login: string
  password: string
}
