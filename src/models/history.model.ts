export interface RequestComment {
  id: string;
  request_id: string;
  user_id: string;
  comment: string;
  created_at: string;
  updated_at: string;
  user_name?: string; // populated via JOIN
}

