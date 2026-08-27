import type { PositionState } from './state.js';

function assertSeatSet(survivorSeats: readonly number[], maxSeats: number): void {
  if (!Number.isSafeInteger(maxSeats) || maxSeats < 2 || maxSeats > 6) {
    throw new RangeError('maxSeats must be a physical table size from 2 through 6');
  }
  if (survivorSeats.length < 2 || new Set(survivorSeats).size !== survivorSeats.length) {
    throw new RangeError('at least two unique survivors are required');
  }
  if (survivorSeats.some((seat) => !Number.isSafeInteger(seat) || seat < 0 || seat >= maxSeats)) {
    throw new RangeError('survivor seat is outside the physical table');
  }
}

function firstClockwiseAfter(position: number, survivors: ReadonlySet<number>, maxSeats: number): number {
  for (let offset = 1; offset <= maxSeats; offset += 1) {
    const seat = (position + offset) % maxSeats;
    if (survivors.has(seat)) {
      return seat;
    }
  }
  throw new RangeError('no survivor found clockwise');
}

export function assignInitialPositions(
  initialButtonSeat: number,
  survivorSeats: readonly number[],
  maxSeats: number,
): PositionState {
  assertSeatSet(survivorSeats, maxSeats);
  const survivors = new Set(survivorSeats);
  if (!survivors.has(initialButtonSeat)) {
    throw new RangeError('initial button must be occupied');
  }

  if (survivorSeats.length === 2) {
    return {
      buttonPosition: initialButtonSeat,
      smallBlindSeat: initialButtonSeat,
      bigBlindSeat: firstClockwiseAfter(initialButtonSeat, survivors, maxSeats),
    };
  }

  const smallBlindSeat = firstClockwiseAfter(initialButtonSeat, survivors, maxSeats);
  return {
    buttonPosition: initialButtonSeat,
    smallBlindSeat,
    bigBlindSeat: firstClockwiseAfter(smallBlindSeat, survivors, maxSeats),
  };
}

export function advancePositions(
  previous: PositionState,
  survivorSeats: readonly number[],
  maxSeats: number,
): PositionState {
  assertSeatSet(survivorSeats, maxSeats);
  const survivors = new Set(survivorSeats);

  if (survivorSeats.length === 2) {
    const bigBlindSeat = firstClockwiseAfter(previous.bigBlindSeat, survivors, maxSeats);
    const buttonPosition = firstClockwiseAfter(bigBlindSeat, survivors, maxSeats);
    return {
      buttonPosition,
      smallBlindSeat: buttonPosition,
      bigBlindSeat,
    };
  }

  return {
    buttonPosition: (previous.buttonPosition + 1) % maxSeats,
    smallBlindSeat: survivors.has(previous.bigBlindSeat) ? previous.bigBlindSeat : null,
    bigBlindSeat: firstClockwiseAfter(previous.bigBlindSeat, survivors, maxSeats),
  };
}
