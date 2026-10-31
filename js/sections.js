// The fixed sections on the main page. A sub-section is a notebook with a
// sectionId; presets fill the "Add sub-section" dropdown. A section marked `app`
// has its own pages instead of notebooks.
// `light` is also the tile and header colour, so it must stay readable under
// white text. `dark` is the accent in dark mode, under dark text.

export const SECTIONS = [
  { id: 'personal', name: 'Personal', icon: 'user', light: '#6d3fc4', dark: '#b9a0f4',
    presets: ['General', 'Fitness', 'Learning', 'Reading', 'Habits'] },
  { id: 'payments', name: 'Payments', icon: 'card', light: '#0e7490', dark: '#5cc8e0', app: true, presets: [] },
  { id: 'family', name: 'Family', icon: 'users', light: '#c2255c', dark: '#f58fb0',
    presets: ['Wife', 'Kids', 'Parents & Siblings'] },
  { id: 'household', name: 'Household', icon: 'home', light: '#94590a', dark: '#f2b04e',
    presets: ['Maintenance', 'Utilities & Resources', 'Kitchen Inventory', 'Cleaning', 'Appliances', 'Warranty'] },
  { id: 'vehicles', name: 'Vehicles', icon: 'car', light: '#475569', dark: '#a8b6c9',
    presets: ['Insurances', 'Service & Repairs', 'Accessories'] },
  { id: 'finance', name: 'Finance', icon: 'chart', light: '#1f7a3d', dark: '#6fd08f',
    presets: ['Budget', 'Expense', 'Debt', 'Portfolio', 'Insurance', 'Goals', 'Tax', 'Estate Planning'] },
  { id: 'work', name: 'Work', icon: 'briefcase', light: '#1d5fd1', dark: '#8fb3f7',
    presets: ['Goals', 'Meeting', 'Learning', 'Challenges'] },
];

// Home for notebooks that predate sections or arrive from an old backup.
export const DEFAULT_SECTION = 'personal';

export const sectionById = id => SECTIONS.find(s => s.id === id);

export const NOTE_SECTIONS = SECTIONS.filter(s => !s.app);
export const isNoteSection = id => NOTE_SECTIONS.some(s => s.id === id);
