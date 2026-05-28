# Copilot Instructions for AI Agents

## Project Overview
This is an Angular-based application for managing purchase requests, users, and notifications. The architecture is modular, with clear separation between components, services, guards, models, and pipes. The app integrates with Supabase for authentication and data storage.

## Key Architectural Patterns
- **Components**: UI logic is split into feature folders (e.g., `dashboard`, `login`, `requests`, `users`). Each feature has its own HTML, TypeScript, and CSS files.
- **Services**: Business logic and API calls are handled in `src/services/`. For example, `auth.service.ts` manages authentication, while `request.service.ts` handles purchase requests.
- **Guards**: Route protection is implemented in `guards/auth.guard.ts` using logic from `auth.logic.service.ts`.
- **Models**: Data structures are defined in `models/` (e.g., `user.model.ts`, `request.model.ts`).
- **Pipes**: Custom pipes (e.g., `safe-html.pipe.ts`) are used for data transformation in templates.

## Developer Workflows
- **Install dependencies**: `npm install`
- **Run locally**: `npm run dev`
- **Environment setup**: Set `GEMINI_API_KEY` in `.env.local` for Gemini API integration.
- **Proxy configuration**: See `proxy.conf.json` for API proxying during development.
- **Main entry point**: `src/main.ts` bootstraps the Angular app.

## Project-Specific Conventions
- **Feature-first structure**: Components are grouped by feature, not by type.
- **Service injection**: Services are injected via Angular's dependency injection in component constructors.
- **Supabase integration**: All authentication and user management flows use `supabase.service.ts` and related config in `supabase.config.ts`.
- **Password and session flows**: See markdown guides (e.g., `FIX_PASSWORD_REDIRECT.md`, `RESET_PASSWORD_IMPLEMENTATION.md`) for custom logic and troubleshooting.
- **Material design**: UI elements follow Angular Material conventions, with models in `material.model.ts` and logic in `material.service.ts`.

## Integration Points
- **Supabase**: Used for authentication, user management, and data storage. Key files: `supabase.service.ts`, `supabase.config.ts`.
- **Gemini API**: Requires API key in `.env.local`.
- **Angular Material**: Used for UI components and styling.

## Cross-Component Communication
- **Services**: Shared state and logic are managed via services (e.g., `notification.service.ts` for app-wide notifications).
- **Guards**: Route access is controlled by guards using service logic.

## References & Guides
- For password/session issues, see: `FIX_PASSWORD_REDIRECT.md`, `FIX_SESSION_ERROR_PASSWORD.md`, `RESET_PASSWORD_IMPLEMENTATION.md`.
- For Supabase setup, see: `SETUP_RESET_PASSWORD_SUPABASE.md`, `SQL_SUPABASE_SETUP.sql`.
- For testing, see: `TESTING_GUIDE.md`, `GUIA_TESTES.md`.

---
**Example:**
To add a new feature, create a folder in `src/components/`, add your component files, update routes in `app.routes.ts`, and inject any required services.

---
**AI agents should follow the above conventions and reference the guides for any non-standard flows.**
