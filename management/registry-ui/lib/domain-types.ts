/** GET /admin/me 实际返回 roles/permissions，与 swagger User 不完全一致时的 UI 类型 */
export type AdminUser = {
  id: number;
  username: string;
  roles: string[];
  permissions?: string[];
  created_at: string;
  updated_at: string;
};

/** GET /admin/permissions 响应项 */
export type PermissionItem = {
  slug: string;
  description: string;
};
