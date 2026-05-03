import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Wspólny schema dla EN i PL — zawartość strony.
// Rozdzielamy na dwie kolekcje, by ID nie kolidowały (np. 'index' EN vs PL).
const pageSchema = z.object({
  title: z.string(),
  description: z.string(),
  slug: z.string().optional(),
  locale: z.enum(['en', 'pl']),
  edition: z.string().optional(),
  event_date: z.string().optional(),
  venue: z.string().optional(),
  hero: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    notice: z.string().optional(),
    image: z.string().optional(),
    background_video: z.string().optional(),
    cta: z.object({
      label: z.string(),
      href: z.string(),
    }).optional(),
    ctas: z.array(z.object({
      label: z.string(),
      href: z.string(),
      primary: z.boolean().optional(),
    })).optional(),
  }).optional(),
  countdown: z.object({
    enabled: z.boolean(),
    to: z.string(),
  }).optional(),
  retail_chains_2026: z.array(z.object({
    name: z.string(),
    logo: z.string(),
  })).optional(),
  distributors_2026: z.array(z.object({
    name: z.string(),
    logo: z.string(),
  })).optional(),
  participants_2025: z.array(z.object({
    name: z.string(),
    logo: z.string(),
  })).optional(),
  reviews: z.array(z.object({
    quote: z.string(),
    author: z.string(),
    company: z.string(),
    logo: z.string().optional(),
  })).optional(),
  booth_options: z.any().optional(),
  exhibitor_bonus: z.any().optional(),
  exhibitors_2025: z.any().optional(),
}).passthrough();

const pagesEn = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages/en' }),
  schema: pageSchema,
});

const pagesPl = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages/pl' }),
  schema: pageSchema,
});

export const collections = { pagesEn, pagesPl };
