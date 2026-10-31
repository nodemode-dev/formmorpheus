// Every registered effect: one import per effect file (each file calls registerEffect when loaded).
// Import this module wherever lanes of these effects can be drawn or edited (render.ts and the Action menu do).
import './shadow';
import './glow';
import './colorcorrect';
import './vignette';
import './pixelate';
import './directional-blur';
import './radial-blur';
import './key';
import './motion-blur';
import './chromatic';
import './mirror';
