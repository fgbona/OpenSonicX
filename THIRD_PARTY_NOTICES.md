# Third-party notices

## zxmarcos/waveod and zxmarcos/matribox-studio

https://github.com/zxmarcos/waveod (a reimplemented Matribox II Pro firmware) and
https://github.com/zxmarcos/matribox-studio (an editor and SDK for the unit). Used here: protocol
facts cross-checked against them (docs/matribox.md) and the DSP figures behind the estimated DSP
load (`packages/core/src/matribox/dsp-load.ts`: the overload rule, the chain budget, the measured
costs of the stock Cab/IR, Clone and amps, the memory rule), and the layout of the preset's assignment
sections and the writes of footswitch functions and quick knobs (`packages/core/src/matribox/write.ts`,
`assignments.ts`). Both are under this license:

MIT License

Copyright (c) 2026 Marcos Medeiros

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
