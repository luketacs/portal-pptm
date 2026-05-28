export type UserRole = 'Solicitante' | 'Admin' | 'Visualizador';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  department: string;
  position: string;
  role: UserRole;
  must_change_password: boolean;
}