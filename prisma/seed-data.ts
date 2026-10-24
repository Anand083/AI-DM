import type { PlanLimits } from "../src/lib/plan-limits";

const base: PlanLimits = {
  maxClients: 5,
  maxProjects: 5,
  maxKeywords: 250,
  maxTeamMembers: 2,
  maxClientUsers: 5,
  auditPagesPerMonth: 2000,
  keywordResearchPerMonth: 100,
  liveChecksPerMonth: 50,
  aiChecksPerMonth: 100,
  backlinkQueriesPerMonth: 50,
  leadAuditsPerMonth: 50,
  reportSchedules: 5,
  customDomain: false,
  whiteLabel: true,
};

export const PLANS = [
  {
    code: "STARTER",
    name: "Starter",
    priceMonthlyCents: 4900,
    priceYearlyCents: 49000,
    sortOrder: 1,
    limits: base,
  },
  {
    code: "GROWTH",
    name: "Growth",
    priceMonthlyCents: 14900,
    priceYearlyCents: 149000,
    sortOrder: 2,
    limits: {
      ...base,
      maxClients: 20,
      maxProjects: 20,
      maxKeywords: 1000,
      maxTeamMembers: 5,
      maxClientUsers: 20,
      auditPagesPerMonth: 10000,
      keywordResearchPerMonth: 500,
      liveChecksPerMonth: 200,
      aiChecksPerMonth: 500,
      backlinkQueriesPerMonth: 250,
      leadAuditsPerMonth: 200,
      reportSchedules: 20,
      customDomain: true,
    },
  },
  {
    code: "AGENCY",
    name: "Agency",
    priceMonthlyCents: 39900,
    priceYearlyCents: 399000,
    sortOrder: 3,
    limits: {
      ...base,
      maxClients: -1,
      maxProjects: -1,
      maxKeywords: 3000,
      maxTeamMembers: 15,
      maxClientUsers: -1,
      auditPagesPerMonth: 50000,
      keywordResearchPerMonth: 2000,
      liveChecksPerMonth: 1000,
      aiChecksPerMonth: 2000,
      backlinkQueriesPerMonth: 1000,
      leadAuditsPerMonth: 1000,
      reportSchedules: -1,
      customDomain: true,
    },
  },
] as const;

export const DEMO_PASSWORD = "Demo-pass-123";

export const DEMO_USERS = [
  {
    id: "seed_user_admin",
    name: "Super Admin",
    email: "superadmin@example.test",
    isSuperAdmin: true,
  },
  { id: "seed_user_a1_owner", name: "Olivia Owner", email: "owner1@example.test" },
  { id: "seed_user_a1_admin", name: "Adam Admin", email: "admin1@example.test" },
  { id: "seed_user_a1_member", name: "Mia Member", email: "member1@example.test" },
  { id: "seed_user_a2_owner", name: "Oscar Owner", email: "owner2@example.test" },
  { id: "seed_user_a2_member", name: "Maya Member", email: "member2@example.test" },
] as const;

export const DEMO_AGENCIES = [
  {
    id: "seed_agency_one",
    slug: "agency-one",
    name: "Agency One",
    timezone: "America/New_York",
    plan: "GROWTH",
    members: [
      ["seed_user_a1_owner", "OWNER"],
      ["seed_user_a1_admin", "ADMIN"],
      ["seed_user_a1_member", "MEMBER"],
    ],
    clients: [
      ["Bright Dental", "brightdental.example"],
      ["Green Garden Supply", "greengarden.example"],
      ["Northwind Legal", "northwindlegal.example"],
    ],
  },
  {
    id: "seed_agency_two",
    slug: "agency-two",
    name: "Agency Two",
    timezone: "Europe/London",
    plan: "STARTER",
    members: [
      ["seed_user_a2_owner", "OWNER"],
      ["seed_user_a2_member", "MEMBER"],
    ],
    clients: [
      ["Blue Bay Cafe", "bluebaycafe.example"],
      ["Peak Fitness", "peakfitness.example"],
      ["Oak and Iron Furniture", "oakandiron.example"],
    ],
  },
] as const;
