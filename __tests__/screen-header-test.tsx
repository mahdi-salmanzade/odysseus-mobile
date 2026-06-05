/**
 * Layer 2 — component rendering. Proves the React Native render + interaction
 * pipeline works in CI (no simulator). ScreenHeader is the shared chrome on
 * every screen, so its title/menu contract is worth pinning.
 *
 * Note: in @testing-library/react-native v14 (React 19 / new test-renderer)
 * `render` is ASYNC — it must be awaited, or the queries come back undefined.
 */
import { render, fireEvent } from '@testing-library/react-native';

import { ScreenHeader } from '@/components/screen-header';

describe('<ScreenHeader />', () => {
  test('renders the title', async () => {
    const { getByText } = await render(<ScreenHeader title="Sessions" />);
    expect(getByText('Sessions')).toBeTruthy();
  });

  test('shows the menu button and fires onMenu when pressed', async () => {
    const onMenu = jest.fn();
    const { getByLabelText } = await render(<ScreenHeader title="Chat" onMenu={onMenu} />);

    fireEvent.press(getByLabelText('Open menu'));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  test('omits the menu button when no onMenu is given', async () => {
    const { queryByLabelText } = await render(<ScreenHeader title="Chat" />);
    expect(queryByLabelText('Open menu')).toBeNull();
  });
});
