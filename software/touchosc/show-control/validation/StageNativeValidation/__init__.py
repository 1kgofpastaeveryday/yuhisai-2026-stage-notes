"""Temporary Live main-thread tests. Enable only with a SILENT fixture open.

Inherits the repository receiver unchanged. No test commands are added to its
OSC protocol. Results are written next to this validation package, not in ALS.
"""
import json
import pathlib
import time

from StageShowControl import StageShowControl, acts_for_song

HERE = pathlib.Path(__file__).resolve().parent.parent


def create_instance(c_instance):
    return StageNativeValidation(c_instance)


class StageNativeValidation(StageShowControl):
    def __init__(self, c_instance):
        super(StageNativeValidation, self).__init__(c_instance)
        self._native_generator = None
        self._native_name = None
        self._native_results = []
        mode_file = HERE / 'work' / 'reload-check.json'
        self._native_reload = json.loads(mode_file.read_text()) if mode_file.exists() else None
        self.schedule_message(20, self._native_tick)

    def _record(self, check, passed, **detail):
        self._native_results.append(dict(check=check, passed=bool(passed), **detail))
        suffix = '-reload-live.json' if self._native_reload else '-live.json'
        destination = HERE / 'results' / (self._native_profile + suffix)
        destination.write_text(json.dumps(dict(show=self._native_profile,
            fixture=self._native_name, checks=self._native_results),
            ensure_ascii=False, indent=2) + '\n', encoding='utf8')

    def _native_tick(self):
        if not self._running:
            return
        try:
            name = self.song().name
            if self._native_generator is None and name != self._native_name:
                for key, profile in self._profiles.items():
                    if name == key + '-NATIVE-TEST-SILENT':
                        acts_for_song(profile, self.song())
                        self._native_name = name
                        self._native_profile = key
                        self._native_results = []
                        self._native_generator = self._tests(key)
                        break
            if self._native_generator is not None:
                try:
                    next(self._native_generator)
                except StopIteration:
                    self._native_generator = None
        except Exception as error:
            self.song().stop_playing()
            self.log_message('Native validation failed: ' + repr(error))
            if hasattr(self, '_native_profile'):
                self._record('runner_error', False, error=repr(error))
            self._native_generator = None
        self.schedule_message(1, self._native_tick)

    def _ticks(self, count):
        for _ in range(count):
            yield

    def _until(self, condition, label, timeout=3):
        deadline = time.monotonic() + timeout
        while not condition():
            if time.monotonic() >= deadline:
                raise RuntimeError('Native state did not settle: ' + label)
            yield

    def _stopped(self):
        self.song().stop_playing()
        yield from self._until(lambda: not self.song().is_playing, 'stop')
        yield from self._ticks(5)

    def _position(self, position):
        self.song().start_time = position
        self.song().current_song_time = position
        yield from self._until(lambda: abs(float(self.song().current_song_time)-position) < .01, 'seek ' + str(position))
        yield from self._ticks(5)

    def _tests(self, key):
        song = self.song()
        self._profile = key
        profile = self._profiles[key]
        original_order = list(self._orders[key])
        tracks = list(song.tracks) + list(song.return_tracks) + [song.master_track]
        silent = (all(t.mixer_device.volume.value == 0 for t in tracks)
                  and all(t.mute for t in list(song.tracks) + list(song.return_tracks))
                  and not any(t.devices for t in tracks))
        self._record('fixture_guard', silent,
            tracks=len(song.tracks), source='Live API')
        if not silent:
            raise RuntimeError('Silent fixture guard failed; refusing playback')
        if self._native_reload:
            assert key == self._native_reload['show']
            expected = self._native_reload['expected']
            self._record('order_persisted_after_reload', self._orders[key] == expected,
                         expected=expected, actual=self._orders[key])
            yield from self._stopped()
            second = profile['acts'][expected[0]-1]
            following = profile['acts'][expected[1]-1]
            self._control('locate', second['start_locator'])
            yield from self._until(lambda: abs(float(song.current_song_time)-second['start']) < .01, 'reordered performance head')
            self._control('resume', '')
            yield from self._until(lambda: song.is_playing, 'reordered performance playback')
            yield from self._ticks(3)
            self._record('reordered_playback_started', second['start'] <= song.current_song_time < second['start'] + 4,
                         expected=second['start'], actual=float(song.current_song_time))
            song.current_song_time = second['end'] - 4
            yield from self._until(lambda: song.current_song_time >= second['end'] - 4, 'playing seek near stop')
            yield from self._until(lambda: not song.is_playing, 'actual reordered SETSTOP', timeout=12)
            self._record('reordered_setstop', abs(float(song.current_song_time)-second['end']) < .5,
                         expected=second['end'], actual=float(song.current_song_time))
            self._advance(9009)
            yield from self._ticks(5)
            self._record('reordered_advance_after_actual_setstop', song.is_playing and
                         following['start'] <= song.current_song_time < following['start'] + 4,
                         expected=following['start'], actual=float(song.current_song_time))
            yield from self._stopped()
            yield from self._position(second['end'])
            self._advance(9010)
            self._control('stop', '')
            before_commit = float(song.current_song_time)
            yield from self._ticks(5)
            self._record('pending_resume_cancelled', not song.is_playing and
                         abs(float(song.current_song_time)-following['start']) < .001,
                         before_native_seek_committed=before_commit,
                         actual=float(song.current_song_time), playing=song.is_playing,
                         expected_prepared_head=following['start'])
            original = self._native_reload['original']
            self._control('reorder', ','.join(map(str, original)))
            stored = json.loads(self._order_file.read_text(encoding='utf8'))
            original_names = [profile['acts'][i-1]['start_locator'] for i in original]
            self._record('original_order_restored', self._orders[key] == original and stored[key] == original_names)
            self._record('runner_complete', True)
            return
        # Every stop is approached by playback, never asserted merely by seeking.
        for act in profile['acts']:
            yield from self._stopped()
            yield from self._position(act['end'] - 4)
            self._record('stop_approach', True, title=act['title'],
                         position=float(song.current_song_time), tempo=float(song.tempo))
            song.start_playing()
            yield from self._until(lambda: song.is_playing, 'start playback')
            deadline = time.monotonic() + 12
            observed_playing = song.is_playing
            while song.is_playing and time.monotonic() < deadline:
                yield
            position = float(song.current_song_time)
            passed = observed_playing and not song.is_playing and abs(position - act['end']) < .5
            self._record('setstop', passed, title=act['title'], expected=act['end'],
                         actual=position, observed_playing=observed_playing)
            yield from self._stopped()
        act = profile['acts'][0]
        self._control('locate', act['start_locator'])
        yield from self._until(lambda: abs(float(song.current_song_time)-act['start']) < .01, 'explicit head')
        position = float(song.current_song_time)
        self._control('resume', '')
        yield from self._until(lambda: song.is_playing, 'resume at head')
        yield from self._ticks(3)
        self._record('explicit_head_resume', song.is_playing and
            abs(position - act['start']) < .001 and song.current_song_time > position,
            expected=act['start'], actual_head=position, playing=song.is_playing)
        self._control('stop', '')
        yield from self._until(lambda: not song.is_playing, 'manual stop')
        yield from self._ticks(5)
        position = float(song.current_song_time)
        for _ in range(5):
            self._control('stop', '')
        self._record('repeated_stop', abs(float(song.current_song_time) - position) < .001,
                     expected=position, actual=float(song.current_song_time))
        self._control('resume', '')
        immediate = float(song.current_song_time)
        yield from self._until(lambda: song.is_playing, 'manual resume')
        yield from self._ticks(3)
        self._record('manual_resume', song.is_playing and abs(immediate-position) < .001
                     and song.current_song_time > position,
                     expected=position, immediate=immediate, later=float(song.current_song_time))
        yield from self._stopped()
        other = next(p for p in self._profiles if p != key)
        self._profile = other
        position = float(song.current_song_time)
        try:
            self._control('resume', '')
            rejected = False
        except ValueError:
            rejected = True
        self._record('wrong_show', rejected and not song.is_playing and
                     abs(float(song.current_song_time)-position) < .001)
        self._profile = key
        if key == 'dfs-day1':
            order = [2, 1] + list(range(3, len(profile['acts'])+1))
            self._control('reorder', ','.join(map(str, order)))
            saved = json.loads(self._order_file.read_text(encoding='utf8'))
            expected_names = [profile['acts'][i-1]['start_locator'] for i in order]
            self._record('order_saved', saved[key] == expected_names, order=order)
            end = profile['acts'][1]['end']
            second = profile['acts'][1]
            self._control('locate', second['start_locator'])
            yield from self._until(lambda: abs(float(song.current_song_time)-second['start']) < .01, 'reordered head')
            self._control('resume', '')
            yield from self._until(lambda: song.is_playing, 'reordered stop approach')
            yield from self._ticks(3)
            song.current_song_time = end - 4
            yield from self._until(lambda: song.current_song_time >= end - 4, 'playing seek near reordered stop')
            yield from self._until(lambda: not song.is_playing, 'reordered SETSTOP', timeout=12)
            self._record('reordered_setstop', abs(float(song.current_song_time)-end) < .5,
                         expected=end, actual=float(song.current_song_time))
            self._advance(9001)
            yield from self._ticks(3)
            self._record('reordered_advance', song.is_playing and
                act['start'] <= song.current_song_time < act['start'] + 4,
                expected_start=act['start'], actual=float(song.current_song_time))
            yield from self._stopped()
            yield from self._position(profile['acts'][1]['end'])
            self._advance(9002)
            self._control('stop', '')
            cancelled_at = float(song.current_song_time)
            yield from self._ticks(3)
            self._record('pending_resume_cancelled', not song.is_playing and
                         abs(float(song.current_song_time)-act['start']) < .001,
                         before_native_seek_committed=cancelled_at,
                         actual=float(song.current_song_time), playing=song.is_playing,
                         expected_prepared_head=act['start'])
            yield from self._position(profile['acts'][order[-1]-1]['end'])
            try:
                self._advance(9003)
                ended = False
            except ValueError as error:
                ended = str(error) == 'セット終了'
            self._record('final_act', ended and not song.is_playing)
            # Leave changed order for the required disable/re-enable persistence check.
            self._record('reload_order_pending', False, expected=order,
                         original_order=original_order,
                         note='Disable/re-enable receiver, then inspect order_state and restore original order.')
        song.stop_playing()
        self._record('runner_complete', True)
