export interface PotContribution {
  readonly seatIndex: number;
  readonly committedHand: number;
  readonly folded: boolean;
}

export interface PotLayer {
  readonly amount: number;
  readonly cap: number;
  readonly eligibleSeats: readonly number[];
}

export interface Refund {
  readonly seatIndex: number;
  readonly amount: number;
}

export interface PotLayers {
  readonly pots: readonly PotLayer[];
  readonly refunds: readonly Refund[];
}

export function buildPotLayers(
  contributions: readonly Readonly<PotContribution>[],
): PotLayers {
  const ordered = [...contributions].sort((left, right) => left.seatIndex - right.seatIndex);
  const caps = [...new Set(ordered
    .map((contribution) => contribution.committedHand)
    .filter((amount) => amount > 0))]
    .sort((left, right) => left - right);
  const pots: PotLayer[] = [];
  const refunds: Refund[] = [];
  let previousCap = 0;

  for (const cap of caps) {
    const contributors = ordered.filter((contribution) => contribution.committedHand >= cap);
    const amount = (cap - previousCap) * contributors.length;
    if (contributors.length === 1) {
      refunds.push({ seatIndex: contributors[0]!.seatIndex, amount });
    } else {
      const layer: PotLayer = {
        amount,
        cap,
        eligibleSeats: contributors
          .filter((contribution) => !contribution.folded)
          .map((contribution) => contribution.seatIndex),
      };
      const equivalentIndex = pots.findIndex((pot) => pot.eligibleSeats.length
        === layer.eligibleSeats.length
        && pot.eligibleSeats.every((seatIndex, index) => seatIndex === layer.eligibleSeats[index]));
      if (equivalentIndex === -1) {
        pots.push(layer);
      } else {
        const equivalent = pots[equivalentIndex]!;
        pots[equivalentIndex] = {
          amount: equivalent.amount + layer.amount,
          cap: layer.cap,
          eligibleSeats: equivalent.eligibleSeats,
        };
      }
    }
    previousCap = cap;
  }

  return { pots, refunds };
}
