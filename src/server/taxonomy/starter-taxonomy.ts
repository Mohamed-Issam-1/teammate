import { toNameKey } from "./normalize";

/**
 * TeamMate curated starter taxonomy — product-owner approved Phase 2 baseline.
 *
 * This is product-owned seed content authored for this repository. It is not
 * derived from, and does not claim to represent, any external standards body,
 * industry ontology, or third-party taxonomy.
 *
 * Taxonomy is system-managed. Ordinary users may read these entries and, in a
 * later checkpoint, assign them to themselves, but may never create, rename,
 * recategorize, or delete them.
 *
 * `nameKey` is derived through the approved normalization function rather than
 * hand-written, so a display-name change cannot silently desynchronize it.
 */

export const STARTER_TAXONOMY_SOURCE =
  "TeamMate curated starter taxonomy — product-owner approved Phase 2 baseline.";

/** Stable category labels, matching the approved groupings exactly. */
export const STARTER_SKILL_CATEGORIES = [
  "Programming Languages",
  "Frontend",
  "Backend",
  "Mobile",
  "Databases",
  "Data / AI",
  "DevOps / Tools",
  "Design",
  "Other Technical",
] as const;

export type StarterSkillCategory = (typeof STARTER_SKILL_CATEGORIES)[number];

type StarterSkillSeed = {
  slug: string;
  name: string;
  category: StarterSkillCategory;
};

type StarterInterestSeed = {
  slug: string;
  name: string;
};

const STARTER_SKILLS: readonly StarterSkillSeed[] = [
  // Programming Languages
  { slug: "javascript", name: "JavaScript", category: "Programming Languages" },
  { slug: "typescript", name: "TypeScript", category: "Programming Languages" },
  { slug: "python", name: "Python", category: "Programming Languages" },
  { slug: "java", name: "Java", category: "Programming Languages" },
  { slug: "c-sharp", name: "C#", category: "Programming Languages" },
  { slug: "cpp", name: "C++", category: "Programming Languages" },

  // Frontend
  { slug: "html", name: "HTML", category: "Frontend" },
  { slug: "css", name: "CSS", category: "Frontend" },
  { slug: "react", name: "React", category: "Frontend" },
  { slug: "next-js", name: "Next.js", category: "Frontend" },
  { slug: "vue-js", name: "Vue.js", category: "Frontend" },

  // Backend
  { slug: "node-js", name: "Node.js", category: "Backend" },
  { slug: "express-js", name: "Express.js", category: "Backend" },
  { slug: "laravel", name: "Laravel", category: "Backend" },
  { slug: "django", name: "Django", category: "Backend" },
  { slug: "fastapi", name: "FastAPI", category: "Backend" },
  { slug: "asp-net-core", name: "ASP.NET Core", category: "Backend" },

  // Mobile
  { slug: "flutter", name: "Flutter", category: "Mobile" },
  { slug: "react-native", name: "React Native", category: "Mobile" },

  // Databases
  { slug: "postgresql", name: "PostgreSQL", category: "Databases" },
  { slug: "mysql", name: "MySQL", category: "Databases" },
  { slug: "mongodb", name: "MongoDB", category: "Databases" },

  // Data / AI
  { slug: "machine-learning", name: "Machine Learning", category: "Data / AI" },
  { slug: "data-analysis", name: "Data Analysis", category: "Data / AI" },

  // DevOps / Tools
  { slug: "git", name: "Git", category: "DevOps / Tools" },
  { slug: "docker", name: "Docker", category: "DevOps / Tools" },
  {
    slug: "github-actions",
    name: "GitHub Actions",
    category: "DevOps / Tools",
  },
  { slug: "linux", name: "Linux", category: "DevOps / Tools" },

  // Design
  { slug: "figma", name: "Figma", category: "Design" },
  { slug: "ui-ux-design", name: "UI/UX Design", category: "Design" },

  // Other Technical
  { slug: "cybersecurity", name: "Cybersecurity", category: "Other Technical" },
  { slug: "unity", name: "Unity", category: "Other Technical" },
];

const STARTER_INTERESTS: readonly StarterInterestSeed[] = [
  { slug: "web-development", name: "Web Development" },
  { slug: "mobile-development", name: "Mobile Development" },
  { slug: "artificial-intelligence", name: "Artificial Intelligence" },
  { slug: "machine-learning", name: "Machine Learning" },
  { slug: "data-science", name: "Data Science" },
  { slug: "cybersecurity", name: "Cybersecurity" },
  { slug: "cloud-devops", name: "Cloud & DevOps" },
  { slug: "game-development", name: "Game Development" },
  { slug: "ui-ux-design", name: "UI/UX Design" },
  { slug: "open-source", name: "Open Source" },
  { slug: "entrepreneurship", name: "Entrepreneurship" },
  { slug: "internet-of-things", name: "Internet of Things" },
  { slug: "robotics", name: "Robotics" },
  { slug: "competitive-programming", name: "Competitive Programming" },
  { slug: "software-engineering", name: "Software Engineering" },
];

export type StarterSkill = {
  slug: string;
  name: string;
  nameKey: string;
  category: StarterSkillCategory;
};

export type StarterInterest = {
  slug: string;
  name: string;
  nameKey: string;
};

export const STARTER_SKILL_COUNT = STARTER_SKILLS.length;
export const STARTER_INTEREST_COUNT = STARTER_INTERESTS.length;

/** Starter skills with the derived case-insensitive key. */
export const starterSkills: readonly StarterSkill[] = STARTER_SKILLS.map(
  (entry) => ({ ...entry, nameKey: toNameKey(entry.name) }),
);

/** Starter interests with the derived case-insensitive key. */
export const starterInterests: readonly StarterInterest[] =
  STARTER_INTERESTS.map((entry) => ({
    ...entry,
    nameKey: toNameKey(entry.name),
  }));
