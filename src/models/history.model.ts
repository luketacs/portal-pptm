export interface RequestHistory {
  id: string;
  request_id: string;
  user_id: string;
  action: 'created' | 'status_changed' | 'updated' | 'approved' | 'rejected';
  field_changed?: string;
  old_value?: string;
  new_value?: string;
  comment?: string;
  created_at: string;
  user_name?: string; // populated via JOIN
}

export interface RequestComment {
  id: string;
  request_id: string;
  user_id: string;
  comment: string;
  created_at: string;
  updated_at: string;
  user_name?: string; // populated via JOIN
}

