export type Variables = {
  user: {
    id: string;
    email: string;
    restaurant_id: string;
    restaurant_slug: string;
    name?: string;
    role?: string;
  };
  adminUser: {
    id: string;
    email: string;
    name: string;
    is_admin: true;
  };
};
