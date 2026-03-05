export type LearningCategoryRow = {
  category_id: string;
  name: string;
  sort_order: number | null;
  is_active: boolean;
  created_at: string;
};

export type PackageRow = {
  package_id: string;
  category_id: string;
  title: string;
  description: string | null;
  thumb_url: string | null;
  sort_order: number | null;
  is_active: boolean;
  created_at: string;
};

export type ScenarioRow = {
  scenario_id: string;
  package_id: string;
  title: string;
  scenario_desc: string | null;
  is_active: boolean;
  sort_order: number | null;
  created_at: string;
  thumb_url: string | null;
};

export type ScenarioExampleLineRow = {
  example_id: string;
  scenario_id: string;
  text_en: string;
  text_ko: string | null;
  sort_order: number | null;
};