export type NotificationType = 'new_request' | 'status_update' | 'comment' | 'system' | 'material_update' | 'material_created' | 'material_status_change' | 'material_deleted';

export interface NotificationMetadata {
  requester_name?: string;
  material_code?: string;
  material_id?: string;
  material_description?: string;
  priority?: string;
  old_status?: string;
  new_status?: string;
  updated_by?: string;
  [key: string]: any;
}

export interface Notification {
  id: string;
  user_id: string;
  request_id?: string;
  material_id?: string;
  type: NotificationType;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  read_at?: string;
  metadata?: NotificationMetadata;
}

