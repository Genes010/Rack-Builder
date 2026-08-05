import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rackProjects = sqliteTable(
  "rack_projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    objectKey: text("object_key").notNull(),
    rackCount: integer("rack_count").notNull().default(0),
    gearCount: integer("gear_count").notNull().default(0),
    sizeBytes: integer("size_bytes").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("rack_projects_updated_at_idx").on(table.updatedAt)],
);
