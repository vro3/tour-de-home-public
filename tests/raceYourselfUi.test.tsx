// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RaceHud, RacePicker } from '../src/components/RaceYourself';
import type { GhostRide } from '../src/ride/ghostRace';

const ghost: GhostRide = { id: 'one', startedAt: 1_700_000_000_000, duration: 20, distance: 100,
  complete: true, points: [{ seconds: 0, distance: 0 }, { seconds: 20, distance: 100 }] };
afterEach(cleanup);
describe('Race Yourself controls', () => {
  it('explains empty and legacy history without disabling ordinary riding', () => {
    render(<RacePicker ghosts={[]} selectedId="" onSelect={() => {}} loading={false} error={null} onRetry={() => {}} />);
    expect(screen.getByText(/create your first ghost/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('selects exactly one ride and allows turning the comparison off', () => {
    const select = vi.fn();
    render(<RacePicker ghosts={[ghost]} selectedId="" onSelect={select} loading={false} error={null} onRetry={() => {}} />);
    fireEvent.change(screen.getByLabelText('Previous ride to race'), { target: { value: 'one' } });
    expect(select).toHaveBeenLastCalledWith('one');
    expect(screen.getByRole('option', { name: 'Ride without a ghost' })).toBeTruthy();
  });
  it('offers a retry if history storage fails', () => {
    const retry = vi.fn();
    render(<RacePicker ghosts={[]} selectedId="" onSelect={() => {}} loading={false} error="Storage unavailable" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('shows a paused gap and a ghost progress marker in either ride view', () => {
    render(<RaceHud ghost={ghost} seconds={4} distance={30} totalDistance={100} paused />);
    expect(screen.getByLabelText('Live time gap').textContent).toBe('2.0s ahead');
    expect(screen.getByText(/Paused/)).toBeTruthy();
    expect(screen.getByLabelText('Ghost position').style.left).toBe('20%');
  });
});
