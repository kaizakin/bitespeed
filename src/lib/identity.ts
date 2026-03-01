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

type ReconcileIdentityResult = {
  primaryContactId: number;
  mergedPrimaryIds: number[];
  createdSecondaryContactId: number | null;
  scenario: "new" | "append" | "merge" | "no_change";
};

function buildMatchFilters(
  email: string | null,
  phoneNumber: string | null,
): Array<{ email?: string; phoneNumber?: string }> {
  // build the OR conditions based on whatever user sent
  const filters: Array<{ email?: string; phoneNumber?: string }> = [];

  if (email) {
    filters.push({ email });
  }

  if (phoneNumber) {
    filters.push({ phoneNumber });
  }

  return filters;
}

function getPrimaryIdFromContact(contact: MatchedContact): number {
  if (contact.linkPrecedence === "primary") {
    return contact.id;
  }

  // secondary rows should point to linkedId (their parent primary)
  if (contact.linkedId !== null) {
    return contact.linkedId;
  }

  // fallback for weird/bad data 
  return contact.id;
}

function getUniquePrimaryIds(contacts: MatchedContact[]): number[] {
  const seen = new Set<number>();
  const primaryIds: number[] = [];

  for (const contact of contacts) {
    const primaryId = getPrimaryIdFromContact(contact);

    if (!seen.has(primaryId)) {
      seen.add(primaryId);
      primaryIds.push(primaryId);
    }
  }

  return primaryIds;
}

export async function findTouchedIdentityClusters(
  email: string | null,
  phoneNumber: string | null,
): Promise<TouchedIdentityClusters> {
  const orFilters = buildMatchFilters(email, phoneNumber);

  if (orFilters.length === 0) {
    throw new Error("findTouchedIdentityClusters requires email or phoneNumber");
  }

  const matchedContacts = await prisma.contact.findMany({
    // pull only records that touch this request (email OR phone)
    where: {
      deletedAt: null,
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

  const primaryContactIds = getUniquePrimaryIds(matchedContacts);

  return {
    matchedContacts,
    primaryContactIds,
  };
}

export async function reconcileIdentity(
  email: string | null,
  phoneNumber: string | null,
): Promise<ReconcileIdentityResult> {
  const orFilters = buildMatchFilters(email, phoneNumber);

  if (orFilters.length === 0) {
    throw new Error("reconcileIdentity requires email or phoneNumber");
  }

  return prisma.$transaction(async (tx: any) => {
    // either all identity updates happen or none do
    const matchedContacts: MatchedContact[] = await tx.contact.findMany({
      where: {
        deletedAt: null,
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

    if (matchedContacts.length === 0) {
      // completely new person (at least from what we know)
      const createdPrimary = await tx.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: "primary",
          linkedId: null,
        },
      });

      return {
        primaryContactId: createdPrimary.id,
        mergedPrimaryIds: [],
        createdSecondaryContactId: null,
        scenario: "new" as const,
      };
    }

    const primaryIds = getUniquePrimaryIds(matchedContacts);

    const primaryContacts = await tx.contact.findMany({
      where: {
        id: {
          in: primaryIds,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const oldestPrimary = primaryContacts[0];

    if (!oldestPrimary) {
      throw new Error("No primary contact found for matched contacts");
    }

    const mergedPrimaryIds: number[] = [];

    //  if multiple primaries are hit, merge everything into the oldest one
    for (let i = 1; i < primaryContacts.length; i += 1) {
      const newerPrimary = primaryContacts[i];

      if (!newerPrimary) {
        continue;
      }

      mergedPrimaryIds.push(newerPrimary.id);

      await tx.contact.updateMany({
        // move children of newer primary to the oldest primary
        where: {
          deletedAt: null,
          linkedId: newerPrimary.id,
        },
        data: {
          linkedId: oldestPrimary.id,
        },
      });

      await tx.contact.update({
        where: {
          id: newerPrimary.id,
        },
        data: {
          linkPrecedence: "secondary",
          linkedId: oldestPrimary.id,
        },
      });
    }

    const clusterContacts = await tx.contact.findMany({
      // refresh cluster after merge so append checks use latest state
      where: {
        deletedAt: null,
        OR: [{ id: oldestPrimary.id }, { linkedId: oldestPrimary.id }],
      },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
      },
    });

    let hasEmail = false;
    let hasPhoneNumber = false;

    for (const contact of clusterContacts) {
      if (email && contact.email === email) {
        hasEmail = true;
      }

      if (phoneNumber && contact.phoneNumber === phoneNumber) {
        hasPhoneNumber = true;
      }
    }

    const needsNewEmail = email !== null && !hasEmail;
    const needsNewPhoneNumber = phoneNumber !== null && !hasPhoneNumber;

    let createdSecondaryContactId: number | null = null;

    if (needsNewEmail || needsNewPhoneNumber) {
      // Scenario B: cluster exists but incoming request has fresh info -> append secondary
      const createdSecondary = await tx.contact.create({
        data: {
          email,
          phoneNumber,
          linkPrecedence: "secondary",
          linkedId: oldestPrimary.id,
        },
      });

      createdSecondaryContactId = createdSecondary.id;
    }

    let scenario: "append" | "merge" | "no_change" = "no_change";

    if (mergedPrimaryIds.length > 0) {
      // merge happened (can also include append in same request, but merge takes priority here)
      scenario = "merge";
    } else if (createdSecondaryContactId !== null) {
      // only append happened
      scenario = "append";
    }

    return {
      primaryContactId: oldestPrimary.id,
      mergedPrimaryIds,
      createdSecondaryContactId,
      scenario,
    };
  });
}
