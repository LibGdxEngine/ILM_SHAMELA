/**
 * Token-aligned theme utilities.
 *
 * Source of truth for values: `frontend/design-tokens.json`
 *
 * Navbar token → Tailwind mapping (light / dark):
 * - Background: colors.background.light.secondary (#f9fafb) → bg-gray-50
 *              colors.background.dark.primary (#1f2937) → dark:bg-gray-800
 * - Border: colors.gray[200] (#e5e7eb) → border-gray-200
 *          colors.gray[700] (#374151) → dark:border-gray-700
 * - Brand text: colors.gray[900] (#111827) → text-gray-900
 *              colors.gray[50] (#f9fafb) → dark:text-gray-50
 * - Brand accent: colors.primary[600] (#4f46e5) → text-indigo-600
 *                colors.primary[400] (#818cf8) → dark:text-indigo-400
 * - Links (inactive): colors.gray[600] (#4b5563) → text-gray-600
 *                    colors.gray[100] (#f3f4f6) → dark:text-gray-100
 * - Links (hover bg): colors.gray[50] (#f9fafb) → hover:bg-gray-50
 *                    colors.gray[700] (#374151) → dark:hover:bg-gray-700/60
 * - Links (active bg): colors.primary[50] (#eef2ff) → bg-indigo-50
 *                     colors.primary[900] (#312e81) → dark:bg-indigo-900/40
 * - Links (active text): colors.primary[700] (#4338ca) → text-indigo-700
 *                       colors.primary[200] (#c7d2fe) → dark:text-indigo-200
 */
export const navTheme = {
  shell:
    "shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_1px_2px_0_rgba(0,0,0,0.06)] border-b sticky top-0 z-50 " +
    "bg-gray-50 border-gray-200 " +
    "dark:bg-gray-800 dark:border-gray-700",
  container: "max-w-[80rem] mx-auto px-4",
  row: "flex items-center justify-between h-20",
  left: "flex items-center space-x-12",
  logoLink: "flex items-center gap-3 group",
  logoIconWrap:
    "relative w-10 h-10 transition-transform duration-300 group-hover:scale-105",
  brandText: "text-xl font-bold tracking-tight text-white dark:text-gray-50",
  brandAccent: "text-indigo-600 dark:text-indigo-400",
  linksWrap: "hidden md:flex items-center space-x-2",
  linkBase:
    "px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
  linkActive:
    "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200",
  linkInactive:
    "text-gray-600 hover:text-gray-900 hover:bg-gray-50 " +
    "dark:text-gray-100 dark:hover:text-white dark:hover:bg-gray-700/60",
} as const;

