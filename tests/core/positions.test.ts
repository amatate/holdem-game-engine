import { describe, expect, it } from 'vitest';

import { advancePositions, assignInitialPositions } from '../../src/core/positions.js';
import type { PositionState } from '../../src/core/state.js';

describe('initial positions', () => {
  it('assigns a four-handed button, blinds, and physical seats clockwise', () => {
    expect(assignInitialPositions(0, [0, 1, 2, 3], 4)).toEqual({
      buttonPosition: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
    });
  });

  it('assigns the heads-up button as small blind and the other survivor as big blind', () => {
    expect(assignInitialPositions(0, [0, 1], 2)).toEqual({
      buttonPosition: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
    });
  });
});

describe('position advancement', () => {
  const threeHanded: PositionState = {
    buttonPosition: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
  };

  it.each([
    { survivors: [1, 2], expected: { buttonPosition: 2, smallBlindSeat: 2, bigBlindSeat: 1 } },
    { survivors: [0, 2], expected: { buttonPosition: 2, smallBlindSeat: 2, bigBlindSeat: 0 } },
    { survivors: [0, 1], expected: { buttonPosition: 1, smallBlindSeat: 1, bigBlindSeat: 0 } },
  ])('uses former-BB continuity for the complete three-to-two matrix: $survivors', ({ survivors, expected }) => {
    expect(advancePositions(threeHanded, survivors, 3)).toEqual(expected);
  });

  it.each([
    {
      maxSeats: 4,
      previous: { buttonPosition: 0, smallBlindSeat: 1, bigBlindSeat: 2 },
      survivors: [0, 3],
      expected: { buttonPosition: 0, smallBlindSeat: 0, bigBlindSeat: 3 },
    },
    {
      maxSeats: 5,
      previous: { buttonPosition: 4, smallBlindSeat: 0, bigBlindSeat: 1 },
      survivors: [2, 4],
      expected: { buttonPosition: 4, smallBlindSeat: 4, bigBlindSeat: 2 },
    },
    {
      maxSeats: 6,
      previous: { buttonPosition: 2, smallBlindSeat: 3, bigBlindSeat: 4 },
      survivors: [1, 5],
      expected: { buttonPosition: 1, smallBlindSeat: 1, bigBlindSeat: 5 },
    },
  ])('branches to HU before dead-button logic for $maxSeats-to-two', ({ previous, survivors, maxSeats, expected }) => {
    const positions = advancePositions(previous, survivors, maxSeats);

    expect(positions).toEqual(expected);
    expect(positions.smallBlindSeat).toBe(positions.buttonPosition);
    expect(positions.smallBlindSeat).not.toBe(positions.bigBlindSeat);
  });

  it('leaves the dead former small blind on the button in a multiway hand', () => {
    expect(advancePositions(threeHanded, [0, 2, 3], 4)).toEqual({
      buttonPosition: 1,
      smallBlindSeat: 2,
      bigBlindSeat: 3,
    });
  });

  it('moves the button to a live former small blind and leaves the small blind empty when BB busts', () => {
    expect(advancePositions(threeHanded, [0, 1, 3], 4)).toEqual({
      buttonPosition: 1,
      smallBlindSeat: null,
      bigBlindSeat: 3,
    });
  });

  it('handles both blinds eliminated and advances the next button across the former BB empty seat', () => {
    const first = advancePositions(threeHanded, [0, 3, 4], 5);
    expect(first).toEqual({
      buttonPosition: 1,
      smallBlindSeat: null,
      bigBlindSeat: 3,
    });

    expect(advancePositions(first, [0, 3, 4], 5)).toEqual({
      buttonPosition: 2,
      smallBlindSeat: 3,
      bigBlindSeat: 4,
    });
  });

  it('moves the big-blind obligation through consecutive empty physical seats without compressing survivors', () => {
    const previous: PositionState = {
      buttonPosition: 5,
      smallBlindSeat: 0,
      bigBlindSeat: 1,
    };

    const next = advancePositions(previous, [0, 4, 5], 6);
    expect(next).toEqual({
      buttonPosition: 0,
      smallBlindSeat: null,
      bigBlindSeat: 4,
    });

    expect(advancePositions(next, [0, 4, 5], 6)).toEqual({
      buttonPosition: 1,
      smallBlindSeat: 4,
      bigBlindSeat: 5,
    });
  });
});
