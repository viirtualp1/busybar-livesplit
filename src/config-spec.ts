import { defineConfigSpec, integerIn } from 'busybar-kit/config-spec';

export default defineConfigSpec({
  name: 'livesplit',
  summary: 'The splits and the running clock, off LiveSplit itself',
  sections: [
    {
      kind: 'env',
      file: '.env',
      title: 'Settings',
      fields: [
        {
          key: 'SPLITS_FILE',
          label: 'Splits file',
          type: 'path',
          placeholder: 'C:\\runs\\any-percent.lss',
          hint: 'Leave empty to use whatever LiveSplit opened last',
        },
        {
          key: 'LIVESPLIT_PORT',
          label: 'Port LiveSplit listens on',
          type: 'number',
          fallback: '16834',
          hint: 'LiveSplit → right click → Control → Start TCP Server',
          validate: integerIn(1, 65_535),
        },
        {
          key: 'LIVESPLIT_PROTOCOL',
          label: 'How to talk to it',
          type: 'select',
          fallback: 'auto',
          options: [
            { value: 'auto', label: 'auto', hint: 'try both' },
            { value: 'tcp', label: 'tcp', hint: 'the built-in server' },
            { value: 'ws', label: 'ws', hint: 'the WebSocket one' },
          ],
        },
        {
          key: 'LIVESPLIT_HOST',
          label: 'Where LiveSplit is',
          type: 'text',
          fallback: '127.0.0.1',
          advanced: true,
          hint: 'Another machine on the network, if you run it elsewhere',
        },
        {
          key: 'POLL_MS',
          label: 'How often the timer is read',
          type: 'number',
          advanced: true,
          hint: 'A timer showing hundredths wants this small',
          validate: integerIn(40, 5000),
        },
      ],
    },
  ],
});
