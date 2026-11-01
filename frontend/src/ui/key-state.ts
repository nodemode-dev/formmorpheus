// The Timeline's chosen keyframes as one shared object, so the keyboard commands (Delete a key, Reverse, Set ease) act on the same keys the Timeline draws as chosen.
import { KeySelection } from './timeline-extras';

export const keyChosen = new KeySelection();
