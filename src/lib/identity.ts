import { prisma } from "./prisma";

type MatchedContact = {
  id: number;
  linkedId: number | null;
  linkPrecedence: string;
  email: string | null;
  phoneNumber: string | null;
};

type TouchedIdentityClusters = {
  matchedContacts: MatchedContact[];
  primaryContactIds: number[];
};

export async function findTouchedIdentityClusters(
  email: string | null,
  phoneNumber: string | null,
): Promise<TouchedIdentityClusters> {
  const orFilters: Array<{ email?: string; phoneNumber?: string }> = [];

  if (email) {
    orFilters.push({ email });
  }

  if (phoneNumber) {
    orFilters.push({ phoneNumber });
  }

  if (orFilters.length === 0) {
    throw new Error("findTouchedIdentityClusters requires email or phoneNumber");
  }

  const matchedContacts = await prisma.contact.findMany({
    where: {
      OR: orFilters,
    },
    select: {
      id: true,
      linkedId: true,
      linkPrecedence: true,
      email: true,
      phoneNumber: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const primaryContactIds = [...
    new Set(
      matchedContacts
        .map((contact) =>
          contact.linkPrecedence === "primary" ? contact.id : contact.linkedId,
        )
        .filter((id): id is number => id !== null),
    ),
  ];

  return {
    matchedContacts,
    primaryContactIds,
  };
}
