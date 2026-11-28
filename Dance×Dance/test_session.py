import tempfile
import unittest
from pathlib import Path
from server import AppError, DanceSession

A='a'*36
B='b'*36
C='c'*36

class SessionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.now=1000.
        self.s=DanceSession(self.temp.name,clock=lambda:self.now)
    def tearDown(self):self.temp.cleanup()
    def pair(self):self.s.connect(A);self.s.connect(B)
    def play(self):
        self.pair();self.now+=5;self.s.view(A)
        self.dancer=next(k for k,v in self.s.players.items() if v['role']=='dancer')
        self.dj=next(k for k,v in self.s.players.items() if v['role']=='dj')
    def test_desktop_cannot_take_a_player_slot(self):
        with self.assertRaises(AppError):self.s.connect(C,kind='desktop')
        self.assertEqual(len(self.s.players),0)
    def test_monitor_does_not_trigger_pairing(self):
        self.s.connect(A)
        for _ in range(5):
            result=self.s.monitor()
            self.assertEqual(result['phase'],'waiting')
            self.assertEqual(result['role'],'observer')
        self.assertEqual(len(self.s.players),1)
    def test_desktop_removes_only_its_legacy_participation(self):
        self.pair();self.s.desktop(A)
        self.assertNotIn(A,self.s.players);self.assertIn(B,self.s.players)
        self.assertEqual(self.s.phase,'waiting')
    def test_old_desktop_records_are_not_restored_as_mobile_players(self):
        self.pair();del self.s.players[A]['kind'];self.s.save()
        restored=DanceSession(self.temp.name,clock=lambda:self.now)
        self.assertNotIn(A,restored.players);self.assertIn(B,restored.players)
        self.assertEqual(restored.phase,'waiting')
    def test_three_seconds_start_after_second_device(self):
        first=self.s.connect(A);self.assertEqual(first['phase'],'waiting');self.assertIsNone(first['role'])
        self.now+=20
        second=self.s.connect(B);self.assertEqual(second['phase'],'countdown');self.assertIsNone(second['role'])
        self.now+=2.99;self.assertIsNone(self.s.view(A)['role'])
        self.now+=.01
        a,b=self.s.view(A),self.s.view(B)
        self.assertEqual(a['phase'],'role');self.assertEqual({a['role'],b['role']},{'dancer','dj'})
    def test_repeat_connection_does_not_restart_countdown(self):
        self.pair();deadline=self.s.deadline;self.now+=1
        self.s.connect(A);self.assertEqual(self.s.deadline,deadline)
    def test_third_active_device_rejected(self):
        self.pair()
        with self.assertRaises(AppError) as e:self.s.connect(C)
        self.assertEqual(e.exception.status,409)
    def test_roles_advance_to_play_after_reveal(self):
        self.play();self.assertEqual(self.s.phase,'playing');self.assertEqual(self.s.remaining,100)
    def test_controls_shared_and_invalid_patch_is_atomic(self):
        self.play();patch={'angleL':121.3,'tempoR':.9,'volumeL':.3,'padR':2,'pressedR':2}
        self.s.action(self.dj,'controls',{'patch':patch})
        other=self.s.view(self.dancer)
        for k,v in patch.items():self.assertEqual(other['controls'][k],v)
        before=other['controls']
        with self.assertRaises(AppError):self.s.action(self.dj,'controls',{'patch':{'tempoL':.8,'volumeR':float('nan')}})
        self.assertEqual(before,self.s.controls)
    def test_shake_deduplicates_and_limits_rate(self):
        self.play();self.s.action(self.dancer,'shake',{'event':'one'})
        self.s.action(self.dancer,'shake',{'event':'two'})
        self.assertEqual(self.s.view(self.dj)['remaining'],99)
        self.now+=.4;self.s.action(self.dancer,'shake',{'event':'one'})
        self.assertEqual(self.s.remaining,99)
    def test_wrong_role_and_unknown_identity_cannot_write(self):
        self.play()
        with self.assertRaises(AppError):self.s.action(self.dj,'shake',{'event':'one'})
        with self.assertRaises(AppError):self.s.action(self.dancer,'controls',{'patch':{'volumeL':1}})
        with self.assertRaises(AppError):self.s.view(C)
    def test_complete_shared_once_and_restart_rerolls(self):
        self.play()
        for i in range(100):
            self.now+=.4;self.s.action(self.dancer,'shake',{'event':str(i)})
        self.assertEqual(self.s.view(self.dj)['phase'],'complete');self.assertEqual(self.s.remaining,0)
        self.now+=1;self.s.action(self.dancer,'shake',{'event':'extra'})
        self.assertEqual(len(self.s.history),1)
        result=self.s.action(self.dj,'restart',{})
        self.assertEqual(result['phase'],'countdown');self.assertEqual(result['remaining'],100);self.assertIsNone(result['role'])
    def test_state_survives_server_restart(self):
        self.play();self.s.action(self.dancer,'shake',{'event':'save'})
        restored=DanceSession(self.temp.name,clock=lambda:self.now)
        self.assertEqual(restored.view(self.dj)['remaining'],99)
    def test_leaving_cancels_pairing(self):
        self.pair();self.s.action(A,'leave',{})
        self.assertEqual(self.s.view(B)['phase'],'waiting');self.assertIsNone(self.s.players[B]['role'])

if __name__=='__main__':unittest.main()
