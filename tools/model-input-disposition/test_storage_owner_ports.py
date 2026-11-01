"""Disposable synthetic filesystem capabilities and owned local children only."""
from dataclasses import replace
import json
import os
from pathlib import Path
import signal
import tempfile
import time
import unittest
from unittest.mock import patch

import disposition as v1
import storage_adapter as a
import storage_owner_ports as f


class FilesystemPortsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.base=Path(self.temp.name)
        self.dirs={name:self.base/name for name in ("journal","evidence","registry","retained")}
        self.fds={}
        for name,path in self.dirs.items():
            path.mkdir(mode=0o700)
            self.fds[name]=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
        self.lock_path=self.base/"synthetic_lock"
        self.lock=os.open(self.lock_path,os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600)
        self.lock_dir=os.open(self.base,os.O_RDONLY|os.O_DIRECTORY)
        self.requirements=f.Requirements(os.geteuid(),os.getegid(),0o600)
        self.directory_requirements=replace(self.requirements,mode=0o700)
        self.lock_entry=f.Entry("synthetic_lock",self.lock_path.name,tuple(getattr(self.lock_path.stat(),name) for name in f.FIELDS),a.sha(b""),self.requirements)
        self.manifest=self.entry("retained","manifest","original.json",b'{ "generated":true }')
        self.payload=self.entry("retained","master","original.bin",b"generated payload bytes")
        self.protected=tuple(self.entry("registry",name,name+".json",a.canonical({"synthetic":name}))
                             for name in ("application","selection","policy"))
        self.registry=f.FrozenRegistry("synthetic_scope","synthetic_owner","synthetic_registry","generated_export",
            self.manifest,b'{ "generated":true }',(self.payload,),self.protected,1)
        self.clock=f.ClockEpoch()
        self.config=a.OwnerConfig(self.registry.scope,self.registry.owner,self.clock.source,self.registry.provenance,
            "synthetic_writer","synthetic_reader",("synthetic_resolver",),("disposition",),
            a.Horizons(a.PROPOSED_INTENT_NS,a.PROPOSED_OBSERVATION_NS),60*a.NS,
            a.StreamLimits(536870912,1073741824,1048576,4096))
        self.roots=f.PrivateRoots(self.fds["journal"],self.fds["evidence"],self.fds["registry"],self.fds["retained"],
            f.LockCapability(self.lock_dir,self.lock_entry),self.directory_requirements,self.requirements,True,True)
        now=time.time_ns()
        self.permits=tuple(f.OperationPermit(self.registry.scope,self.registry.owner,"operation"+str(i),
            v1.identity(self.registry.original()),self.clock.source,self.registry.provenance,now-a.NS,now+3600*a.NS,
            ("journal","evidence")) for i in range(12))
        self.owners=[]
        self.ports=self.owner()
        self.adapter=a.StorageAdapter(self.config,self.ports)

    def tearDown(self):
        for owner in self.owners:
            try:owner._release()
            except Exception:pass
            for child in owner.children:
                try:child.p.kill();child.p.wait(timeout=1)
                except Exception:pass
                try:child.p.stdin.close();child.p.stdout.close()
                except OSError:pass
            try:owner.close()
            except Exception:pass
        for fd in self.fds.values():os.close(fd)
        os.close(self.lock);os.close(self.lock_dir)
        self.temp.cleanup()

    def entry(self, root, token, name, raw):
        path=self.dirs[root]/name
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:os.write(fd,raw)
        finally:os.close(fd)
        fields=tuple(getattr(path.stat(),name) for name in f.FIELDS)
        return f.Entry(token,name,fields,a.sha(raw),self.requirements)

    def owner(self, **changes):
        args=dict(roots=self.roots,registry=self.registry,permits=self.permits,clock=self.clock,config=self.config)
        args.update(changes)
        owner=f.FilesystemObservationPorts(**args)
        self.owners.append(owner)
        return owner

    def record(self, index=0):
        return self.ports.record_present(self.adapter,operation="operation"+str(index),event_id="event"+str(index))

    def acquire(self, index=0):
        return self.ports.try_acquire(self.registry.scope,"operation"+str(index),budget_ns=self.config.callback_budget_ns)

    def test_present_observation_and_independent_same_process_readback(self):
        before=(self.dirs["retained"]/self.payload.name).read_bytes()
        result=self.record()
        self.assertEqual(a.parse_record(result["record"])["phase"],"observation")
        marker=a.decode(result["admission"])
        self.assertEqual(marker["profile"],"publication-input-observation-admission-v3")
        self.assertNotIn("committed",marker)
        checked=self.ports.verify_present(self.adapter,operation="operation0",event_id="event0")
        self.assertEqual(checked["projection"]["status"],"supported-observation")
        self.assertEqual(checked["projection"]["state"],"present")
        self.assertEqual(before,(self.dirs["retained"]/self.payload.name).read_bytes())
        self.assertEqual(self.ports.admitted["event0"][:3],tuple(a.sha(result[k]) for k in ("record","verification","admission")))

    def test_owned_directory_lifetime_survives_caller_descriptor_reuse(self):
        rebound=self.base/"rebound";rebound.mkdir(mode=0o700)
        other=os.open(rebound,os.O_RDONLY|os.O_DIRECTORY)
        supplied=self.fds["journal"]
        try:
            self.assertNotEqual(supplied,self.ports.roots.journal_dir_fd)
            os.close(supplied);os.dup2(other,supplied)
            self.record()
            self.assertEqual(list(rebound.iterdir()),[])
            self.assertTrue((self.dirs["journal"]/"event_event0").exists())
        finally:os.close(other)

    def test_two_instances_and_lock_aliases_never_cross_unlock(self):
        import fcntl
        first=self.acquire()
        alias=os.dup(self.lock_dir)
        try:
            second=self.owner()
            aliased=self.owner(roots=replace(self.roots,lock=f.LockCapability(alias,self.lock_entry)))
            for contender in (second,aliased):
                with self.assertRaises(a.AdapterError):contender.try_acquire(self.registry.scope,"operation1",budget_ns=self.config.callback_budget_ns)
            independent=os.open(self.lock_path,os.O_RDWR)
            try:
                with self.assertRaises(BlockingIOError):fcntl.flock(independent,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:os.close(independent)
            self.assertFalse(first.closed)
        finally:first.close();os.close(alias)

    def test_duplicate_and_stale_lease_close_cannot_release_later_lease(self):
        import fcntl
        old=self.acquire()
        self.ports.borrow_available=True
        borrowed=self.ports.try_acquire(self.registry.scope,"operation0",budget_ns=self.config.callback_budget_ns)
        borrowed.close();old.close()
        current=self.acquire(1)
        independent=os.open(self.lock_path,os.O_RDWR)
        try:
            old.close();borrowed.close()
            self.assertIs(self.ports.lease,current)
            with self.assertRaises(a.AdapterError):old.snapshot()
            with self.assertRaises(BlockingIOError):fcntl.flock(independent,fcntl.LOCK_EX|fcntl.LOCK_NB)
        finally:current.close();os.close(independent)

    def test_full_length_event_ids_generate_bounded_content_bound_references(self):
        ids1=self.ports._reference_ids("operation0","a"*63+"b")
        ids2=self.ports._reference_ids("operation0","a"*63+"c")
        self.assertTrue(set(ids1.values()).isdisjoint(ids2.values()))
        for index,event_id in enumerate(("a"*52,"a"*53,"a"*63+"b","a"*63+"c")):
            result=self.ports.record_present(self.adapter,operation="operation"+str(index),event_id=event_id)
            event=a.parse_record(result["record"])
            self.assertEqual(event["id"],event_id)
            self.assertEqual(len(event["evidence"]),3)
            for ref in event["evidence"]:
                self.assertEqual(len(ref["id"]),64)
                raw=(self.dirs["evidence"]/ref["id"]).read_bytes()
                self.assertEqual(ref["id"],self.ports._reference_ids("operation"+str(index),event_id)[ref["role"]])
                self.assertEqual(ref["sha256"],a.sha(raw))
            checked=self.ports.verify_present(self.adapter,operation="operation"+str(index),event_id=event_id)
            self.assertEqual(checked["projection"]["status"],"supported-observation")

    def test_failed_acquisition_cleanup_consumes_only_remaining_deadline(self):
        import fcntl
        (self.dirs["registry"]/self.protected[0].name).write_bytes(b"changed synthetic protected state")
        slow=f._WORKER.replace('   elif op=="close":',
            '   elif op=="close":\n    if lock is not None:time.sleep(2)')
        seen=[];original=f._Child.exchange
        def track(child,request,*,limit,budget_ns):
            if request.get("op")=="close" and self.ports.lease is not None and child is self.ports.lease.child:
                seen.append(budget_ns)
            return original(child,request,limit=limit,budget_ns=budget_ns)
        started=time.monotonic()
        with patch.object(f,"_WORKER",slow),patch.object(f._Child,"exchange",track):
            with self.assertRaises(a.AdapterError):self.ports.try_acquire(self.registry.scope,"operation0",budget_ns=a.NS)
        self.assertLess(time.monotonic()-started,1.8)
        self.assertTrue(seen and all(0<budget<a.NS for budget in seen))
        if self.ports.lease is not None:
            independent=os.open(self.lock_path,os.O_RDWR)
            try:
                with self.assertRaises(BlockingIOError):fcntl.flock(independent,fcntl.LOCK_EX|fcntl.LOCK_NB)
            finally:os.close(independent)

    def test_prelease_keeper_and_transferred_rights_have_tracked_cleanup(self):
        import fcntl
        for stage in ("before_lock","after_reply","after_receive","install"):
            with self.subTest(stage=stage):
                owner=self.owner();seen=[]
                exchange=f._Child.exchange;receive=f._Child.take_lock;held=f.HeldLease
                def controlled_exchange(child,request,*,limit,budget_ns):
                    if request.get("op")=="lock" and stage=="before_lock":
                        seen.append(stage);raise OSError("synthetic startup refusal")
                    result=exchange(child,request,limit=limit,budget_ns=budget_ns)
                    if request.get("op")=="lock" and stage=="after_reply":
                        seen.append(stage);time.sleep(1.1)
                    return result
                def controlled_receive(child,budget_ns):
                    result=receive(child,budget_ns)
                    if stage=="after_receive":
                        seen.append(stage);raise OSError("synthetic received-right reply loss")
                    return result
                def controlled_install(*args):
                    if stage=="install":
                        seen.append(stage);raise OSError("synthetic lease installation failure")
                    return held(*args)
                with patch.object(f._Child,"exchange",controlled_exchange),patch.object(f._Child,"take_lock",controlled_receive),patch.object(f,"HeldLease",controlled_install):
                    with self.assertRaises(Exception):owner.try_acquire(self.registry.scope,"operation0",budget_ns=a.NS)
                self.assertEqual(seen,[stage]);self.assertTrue(owner.failed)
                self.assertIsNone(owner.lease)
                self.assertEqual(list(self.dirs["journal"].iterdir()),[])
                owner.close()
                self.assertTrue(all(child.p.poll() is not None and child.control is None and
                                    all(desc.fd is None for desc in child.pending_descriptions) for child in owner.children))
                independent=os.open(self.lock_path,os.O_RDWR)
                try:
                    fcntl.flock(independent,fcntl.LOCK_EX|fcntl.LOCK_NB)
                finally:os.close(independent)
        raw=os.open(self.lock_path,os.O_RDWR)
        description=f._OwnedDescription(raw);description.close()
        replacement=os.open(self.lock_path,os.O_RDWR)
        if replacement!=raw:
            os.dup2(replacement,raw);os.close(replacement);replacement=raw
        try:
            description.close()
            os.fstat(replacement)
        finally:os.close(replacement)

    def test_v1_stays_unverified_and_closed_to_local_admission_profile(self):
        result=self.record()
        doc=a.admit_request(a.parse_record(result["record"])["request"].encode())
        self.assertEqual(v1.classify([doc],as_of="2026-01-01T00:00:00Z")["authority"],"unverified")
        with self.assertRaises(v1.InputError):v1.parse(result["admission"])

    def test_source_projection_preserves_exact_bytes_and_integer_pins(self):
        exported=self.ports.frozen_export(self.registry.scope,budget_ns=self.config.callback_budget_ns)
        self.assertEqual(exported.original.manifest,self.registry.exact_manifest)
        self.assertEqual(exported.original.identity_object(),self.registry.original())
        self.assertIsNone(exported.release)
        self.assertTrue(all(type(value) is int for value in self.payload.fields))
        self.assertGreater(self.payload.fields[7],2**53)

    def test_only_exact_permit_scope_original_epoch_and_issuer_are_admitted(self):
        for field,value in (("scope","other"),("owner","other"),("epoch","other"),("issuer","other"),("original_identity","a"*64)):
            with self.subTest(field=field):
                owner=self.owner(permits=(replace(self.permits[0],**{field:value}),))
                with self.assertRaises(a.AdapterError):owner.authorize(self.registry.scope,"operation0","disposition","observation",budget_ns=self.config.callback_budget_ns)
        for kind,mode in (("recovery","observation"),("selection","observation"),("disposition","mutation")):
            self.assertFalse(self.ports.authorize(self.registry.scope,"operation0",kind,mode,budget_ns=self.config.callback_budget_ns))

    def test_expired_and_not_yet_valid_permits_refuse_before_namespace_write(self):
        now=time.time_ns()
        for start,end in ((now-10*a.NS,now-5*a.NS),(now+5*a.NS,now+10*a.NS)):
            owner=self.owner(permits=(replace(self.permits[0],not_before_ns=start,expires_ns=end),))
            with self.assertRaises(a.AdapterError):owner.try_acquire(self.registry.scope,"operation0",budget_ns=self.config.callback_budget_ns)
        self.assertEqual(list(self.dirs["journal"].iterdir()),[])

    def test_direct_non_present_and_mutation_writer_misuse_is_refused(self):
        result=self.record()
        lease=self.acquire()
        try:
            original=a.parse_record(result["record"])
            for changed in (dict(state="removed"),dict(phase="intent",mode="mutation"),dict(phase="dispatch",mode="mutation"),dict(kind="recovery",state="unavailable")):
                raw=a.canonical(dict(original,**changed))
                with self.assertRaises(a.AdapterError):self.ports.append(self.registry.scope,"event0",raw,a.sha(result["record"]),budget_ns=self.config.callback_budget_ns)
        finally:lease.close()
        self.assertEqual(len(list(self.dirs["journal"].glob("event_*"))),1)

    def test_unissued_observation_cannot_use_four_argument_authorize_as_permission(self):
        self.assertTrue(self.ports.authorize(self.registry.scope,"operation0","disposition","observation",budget_ns=self.config.callback_budget_ns))
        request=a.canonical(dict(version=1,profile="publication-input-claims-v1",label=self.registry.label,original=self.registry.original(),release=None,events=[]))
        with self.assertRaises(a.AdapterError):self.adapter.record_observation(request,operation="operation0",event_id="forged",kind="disposition",state="removed",references=())
        self.assertFalse((self.dirs["journal"]/"event_forged").exists())

    def test_mutation_and_settlement_ports_never_invoke_effect(self):
        effects=[]
        with self.assertRaisesRegex(a.AdapterError,"mutation-unsupported"):self.ports.dispatch_under_fence(effect=lambda:effects.append(True))
        with self.assertRaisesRegex(a.AdapterError,"settlement-unsupported"):self.ports.independent_dispatch_boundary()
        self.assertEqual(effects,[])

    def test_nested_lock_is_refused_and_helpers_use_one_real_acquisition(self):
        lease=self.acquire()
        try:
            with self.assertRaisesRegex(a.AdapterError,"nested-lock"):self.acquire()
        finally:lease.close()
        with patch.object(self.ports,"_child",wraps=self.ports._child) as called:
            self.record()
        # The record helper lends its held lease to the adapter; it never flocks twice.
        self.assertIsNone(self.ports.lease)
        self.assertTrue(called.call_count>0)

    def test_busy_external_lock_refuses_without_changing_payloads(self):
        import fcntl
        independent=os.open(self.lock_path,os.O_RDWR)
        fcntl.flock(independent,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:
            with self.assertRaises(a.AdapterError):self.acquire()
            self.assertEqual(list(self.dirs["journal"].iterdir()),[])
        finally:fcntl.flock(independent,fcntl.LOCK_UN);os.close(independent)

    def test_unknown_names_traversal_and_unregistered_tokens_are_refused(self):
        for value in ("../source","/source","a/b","a\\b",".","..","https:example"):
            with self.subTest(value=value):
                with self.assertRaises(a.AdapterError):f.basename(value)
        for value in ("unknown","master.json","../master"):
            with self.assertRaises(a.AdapterError):self.ports.stream_state(self.registry.scope,value,budget_ns=self.config.callback_budget_ns)
        for event_id in ("a"*65,"../event",False):
            with self.assertRaises(a.AdapterError):self.ports.record_present(self.adapter,operation="operation0",event_id=event_id)
        with patch.object(a,"sha",return_value="a"*64):
            with self.assertRaisesRegex(a.AdapterError,"reference-collision"):
                self.ports.record_present(self.adapter,operation="operation0",event_id="valid")
        self.assertEqual(list(self.dirs["journal"].iterdir()),[])
        self.assertEqual(list(self.dirs["evidence"].iterdir()),[])

    def test_symlink_and_nonregular_source_entries_are_refused(self):
        path=self.dirs["retained"]/self.payload.name
        path.unlink();path.symlink_to(self.manifest.name)
        with self.assertRaises(a.AdapterError):self.ports.stream_state(self.registry.scope,"master",budget_ns=self.config.callback_budget_ns)

    def test_replaced_backing_path_never_substitutes_another_file(self):
        lease=self.acquire()
        stream=self.ports.open_stream(self.registry.scope,"master",expected_state=self.ports._state(self.payload).sha256,
            max_bytes=self.config.stream_limits.max_payload_bytes,max_chunks=4096,budget_ns=self.config.callback_budget_ns)
        replacement=self.dirs["retained"]/"replacement.bin"
        replacement.write_bytes(b"other synthetic bytes")
        os.replace(replacement,self.dirs["retained"]/self.payload.name)
        try:
            with self.assertRaises(a.AdapterError):stream.close()
        finally:lease.close()

    def test_wrong_owner_mode_link_count_and_coverage_are_not_inferred(self):
        for req in (replace(self.requirements,mode=0o644),replace(self.requirements,uid=self.requirements.uid+1)):
            with self.assertRaises(a.AdapterError):replace(self.payload,requirements=req)
        for changed in (dict(cooperating_namespace_exclusive=False),dict(retained_backing_immutable=False)):
            with self.assertRaises(a.AdapterError):self.owner(roots=replace(self.roots,**changed))
        with self.assertRaises(a.AdapterError):f.Requirements(True,0,0o600)

    def test_stream_eof_short_extra_hash_and_chunk_bounds(self):
        lease=self.acquire()
        try:
            state=self.ports.stream_state(self.registry.scope,"master",budget_ns=self.config.callback_budget_ns)
            stream=self.ports.open_stream(self.registry.scope,"master",expected_state=state.sha256,max_bytes=512,max_chunks=4096,budget_ns=self.config.callback_budget_ns)
            total=b""
            try:
                while True:
                    chunk=stream.read_chunk(max_bytes=4,budget_ns=self.config.callback_budget_ns)
                    if not chunk:break
                    self.assertLessEqual(len(chunk),4);total+=chunk
            finally:stream.close()
            self.assertEqual(a.sha(total),self.payload.sha256)
            self.assertEqual(stream.total,self.payload.fields[6])
        finally:lease.close()

    def test_declared_hash_alone_does_not_verify_actual_payload_bytes(self):
        bad_registry=replace(self.registry,payloads=(replace(self.payload,sha256="a"*64),))
        permit=replace(self.permits[0],original_identity=v1.identity(bad_registry.original()))
        owner=self.owner(registry=bad_registry,permits=(permit,))
        adapter=a.StorageAdapter(self.config,owner)
        with self.assertRaises(a.AdapterError):owner.record_present(adapter,operation="operation0",event_id="event0")
        self.assertFalse((self.dirs["journal"]/"event_event0").exists())

    def test_journal_orphan_and_directory_bound_are_never_hidden(self):
        self.record();lease=self.acquire()
        try:
            path=self.dirs["journal"]/"verify_orphan"
            path.write_bytes(b"generated orphan")
            os.chmod(path,0o600)
            with self.assertRaisesRegex(a.AdapterError,"orphan"):self.ports.ledger(self.registry.scope,max_records=256,max_bytes=a.MAX_LEDGER_BYTES,budget_ns=self.config.callback_budget_ns)
            for index in range(770):(self.dirs["journal"]/("extra_"+str(index))).touch()
            with self.assertRaises(a.AdapterError):self.ports.ledger(self.registry.scope,max_records=256,max_bytes=a.MAX_LEDGER_BYTES,budget_ns=self.config.callback_budget_ns)
        finally:lease.close()

    def test_expected_tail_duplicate_id_and_changed_bytes_do_not_overwrite(self):
        result=self.record();before=(self.dirs["journal"]/"event_event0").read_bytes();lease=self.acquire()
        try:
            for tail in (None,"f"*64,a.sha(result["record"])):
                with self.assertRaises(a.AdapterError):self.ports.append(self.registry.scope,"event0",result["record"],tail,budget_ns=self.config.callback_budget_ns)
        finally:lease.close()
        self.assertEqual(before,(self.dirs["journal"]/"event_event0").read_bytes())

    def test_scope_anchor_change_is_a_frontier_error(self):
        self.record();lease=self.acquire()
        try:
            (self.dirs["journal"]/"scope").write_bytes(b"changed generated anchor")
            with self.assertRaises(a.AdapterError):self.ports.ledger(self.registry.scope,max_records=256,max_bytes=a.MAX_LEDGER_BYTES,budget_ns=self.config.callback_budget_ns)
        finally:lease.close()

    def test_direct_reference_rebinding_and_missing_body_are_refused(self):
        result=self.record();lease=self.acquire()
        try:
            outcome=next(ref["id"] for ref in a.parse_record(result["record"])["evidence"] if ref["role"]=="outcome")
            (self.dirs["evidence"]/outcome).write_bytes(b"changed generated evidence")
            with self.assertRaises(a.AdapterError):self.ports.resolve(self.registry.scope,outcome,max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
            with self.assertRaises(a.AdapterError):self.ports.resolve(self.registry.scope,"unissued",max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
        finally:lease.close()

    def test_disk_only_tentative_admission_cannot_be_promoted(self):
        self.record();self.ports.admitted.clear();lease=self.acquire()
        try:
            self.assertTrue((self.dirs["journal"]/"admit_event0").exists())
            with self.assertRaisesRegex(a.AdapterError,"admission-unconfirmed"):
                self.ports.independent_admission_read(self.registry.scope,"event0",max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
        finally:lease.close()

    def test_restart_with_same_clock_source_still_refuses_old_scope_epoch(self):
        self.record()
        clock=f.ClockEpoch(self.clock.source)
        owner=self.owner(clock=clock)
        with self.assertRaisesRegex(a.AdapterError,"epoch-or-frontier"):
            owner.try_acquire(self.registry.scope,"operation0",budget_ns=self.config.callback_budget_ns)
        self.assertNotEqual(clock.process_epoch,self.clock.process_epoch)

    def test_changed_protected_pins_stop_admission(self):
        path=self.dirs["registry"]/self.protected[0].name
        path.write_bytes(b"changed protected synthetic state")
        with self.assertRaises(a.AdapterError):self.record()
        self.assertEqual(self.ports.admitted,{})

    def test_independent_reader_reopens_actual_bytes_in_another_process(self):
        pids=[];original=self.ports._child
        def track(root, **kwargs):
            child=original(root,**kwargs);pids.append(child.p.pid)
            self.assertEqual(child.p.args[1:4],["-I","-B","-S"])
            return child
        with patch.object(self.ports,"_child",side_effect=track):
            raw=self.ports._read(self.ports.roots.retained_payload_dir_fd,self.payload.name,1024,self.config.callback_budget_ns,self.payload.fields)
        self.assertEqual(a.sha(raw),self.payload.sha256)
        self.assertTrue(pids and all(pid!=os.getpid() for pid in pids))

    def test_reader_stall_output_bound_and_close_timeout_poison_owner(self):
        for script,close in (("import time;time.sleep(2)",False),("import os,struct;os.write(1,struct.pack('>I',100000000))",False),("import time;time.sleep(2)",True)):
            owner=self.owner();child=f._Child(self.fds["retained"],owner._poison,script)
            owner.children.append(child);started=time.monotonic()
            with self.assertRaises(a.AdapterError):
                if close:child.close(50_000_000)
                else:child.exchange({"op":"read"},limit=10,budget_ns=50_000_000)
            self.assertLess(time.monotonic()-started,1)
            self.assertTrue(owner.failed)
        owner=self.owner();lease=owner.try_acquire(self.registry.scope,"operation0",budget_ns=self.config.callback_budget_ns)
        blocker=f._Child(owner.roots.retained_payload_dir_fd,owner._poison,"import time;time.sleep(2)",held_fd=lease.lock_fd)
        owner.children.append(blocker)
        import fcntl
        independent=os.open(self.lock_path,os.O_RDWR)
        try:
            with patch.object(blocker.p,"poll",return_value=None):
                with self.assertRaisesRegex(a.AdapterError,"unreaped-child"):lease.close()
                self.assertIs(owner.lease,lease)
                with self.assertRaises(BlockingIOError):fcntl.flock(independent,fcntl.LOCK_EX|fcntl.LOCK_NB)
        finally:
            blocker.p.kill();blocker.p.wait(timeout=1);blocker.abort()
            lease.close();os.close(independent)

    def test_expiry_during_admission_write_retains_tentative_but_no_capability(self):
        original=self.ports._write
        def expire(root,name,raw,budget_ns):
            ack=original(root,name,raw,budget_ns)
            if name.startswith("admit_"):
                previous=self.clock.sample
                def late():
                    sample=previous()
                    return replace(sample,wall_ns=sample.wall_ns+self.config.horizons.observation_ns,
                                   monotonic_ns=sample.monotonic_ns+self.config.horizons.observation_ns)
                self.clock.sample=late
            return ack
        with patch.object(self.ports,"_write",side_effect=expire):
            with self.assertRaises(a.AdapterError):self.record()
        self.assertTrue((self.dirs["journal"]/"admit_event0").exists())
        self.assertEqual(self.ports.admitted,{})

    def test_lost_write_ack_never_creates_process_admission(self):
        original=self.ports._write
        def lost(root,name,raw,budget_ns):
            result=original(root,name,raw,budget_ns)
            if name.startswith("admit_"):raise TimeoutError("synthetic lost reply")
            return result
        with patch.object(self.ports,"_write",side_effect=lost):
            with self.assertRaises(Exception):self.record()
        self.assertEqual(self.ports.admitted,{})
        self.assertTrue((self.dirs["journal"]/"admit_event0").exists())

    def test_valid_confirmed_admission_survives_lost_readback_reply_same_process(self):
        result=self.record();lease=self.acquire()
        original=self.ports._read
        def lost(root,name,limit,budget_ns,expected=None):
            if name.startswith("admit_"):raise TimeoutError("synthetic lost readback")
            return original(root,name,limit,budget_ns,expected)
        try:
            with patch.object(self.ports,"_read",side_effect=lost):
                with self.assertRaises(TimeoutError):self.ports.independent_admission_read(self.registry.scope,"event0",max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
            read=self.ports.independent_admission_read(self.registry.scope,"event0",max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
            self.assertIs(type(read),a.ProcessAdmissionReadback)
            self.assertEqual(read.raw,result["admission"])
        finally:lease.close()

    def test_plain_readback_flags_cannot_promote_v3_disk_bytes(self):
        result=self.record();lease=self.acquire()
        try:
            read=self.ports.independent_admission_read(self.registry.scope,"event0",max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
            with patch.object(self.ports,"independent_admission_read",return_value=a.Readback(read.raw,read.route,True,True)):
                with self.assertRaises(a.AdapterError):self.adapter.verify_durable_readback(result["record"])
        finally:lease.close()

    def test_process_admission_binds_all_three_exact_hashes(self):
        self.record();lease=self.acquire()
        try:
            path=self.dirs["journal"]/"admit_event0"
            original=path.read_bytes();path.write_bytes(original+b" ")
            with self.assertRaisesRegex(a.AdapterError,"admission-rebound"):
                self.ports.independent_admission_read(self.registry.scope,"event0",max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
        finally:lease.close()

    def test_three_cycles_retain_complete_history_without_truncation(self):
        results=[self.record(i) for i in range(3)]
        checked=self.ports.verify_present(self.adapter,operation="operation2",event_id="event2")
        self.assertEqual(checked["projection"]["history"],[a.sha(result["record"]) for result in results])
        self.assertEqual(checked["projection"]["status"],"supported-observation")
        self.assertEqual(len(list(self.dirs["journal"].glob("event_*"))),3)
        lease=self.acquire(2)
        try:
            event=a.parse_record(results[1]["record"]);event["predecessors"]=[]
            (self.dirs["journal"]/"event_event1").write_bytes(a.canonical(event))
            with self.assertRaisesRegex(a.AdapterError,"fork-or-orphan"):
                self.ports.ledger(self.registry.scope,max_records=256,max_bytes=a.MAX_LEDGER_BYTES,budget_ns=self.config.callback_budget_ns)
        finally:lease.close()

    def test_fsync_stall_is_bounded_and_never_admits_tentative_marker(self):
        slow=f._WORKER.replace("     os.fsync(fd)",
            "     if q['name'].startswith('admit_'):__import__('time').sleep(2)\n     os.fsync(fd)")
        original=f._Child.exchange
        def short(child,request,*,limit,budget_ns):
            if request.get("op")=="write" and request.get("name","").startswith("admit_"):
                budget_ns=250_000_000
            return original(child,request,limit=limit,budget_ns=budget_ns)
        started=time.monotonic()
        with patch.object(f,"_WORKER",slow),patch.object(f._Child,"exchange",short):
            with self.assertRaises(a.AdapterError):self.record()
        self.assertLess(time.monotonic()-started,30)
        self.assertTrue((self.dirs["journal"]/"admit_event0").exists())
        self.assertEqual(self.ports.admitted,{})
        self.assertTrue(self.ports.failed)

    def test_permit_expiry_after_first_role_refuses_later_writes(self):
        original=self.ports._write
        def expire(root,name,raw,budget_ns):
            ack=original(root,name,raw,budget_ns)
            if root==self.ports.roots.evidence_dir_fd and a.decode(raw)["role"]=="outcome":
                self.ports.permits["operation0"]=replace(self.permits[0],expires_ns=time.time_ns()-1)
            return ack
        with patch.object(self.ports,"_write",side_effect=expire):
            with self.assertRaises(a.AdapterError):self.record()
        self.assertEqual([a.decode(path.read_bytes())["role"] for path in self.dirs["evidence"].iterdir()],["outcome"])
        self.assertFalse((self.dirs["journal"]/"event_event0").exists())
        self.assertEqual(self.ports.admitted,{})

    def test_child_rechecks_expiry_after_startup_before_exclusive_create(self):
        original=self.ports._write_authorization
        def soon(root):
            if root==self.ports.roots.evidence_dir_fd:
                self.ports.permits["operation0"]=replace(self.permits[0],expires_ns=time.time_ns()+100_000_000)
            return original(root)
        slow=f._WORKER.replace('    grant=q["grant"];wall=time.time_ns();elapsed=time.monotonic_ns()',
            '    if q["grant"]["target"]=="evidence" and json.loads(data)["role"]=="outcome":time.sleep(.25)\n    grant=q["grant"];wall=time.time_ns();elapsed=time.monotonic_ns()')
        with patch.object(self.ports,"_write_authorization",side_effect=soon),patch.object(f,"_WORKER",slow):
            with self.assertRaises(a.AdapterError):self.record()
        self.assertEqual(list(self.dirs["evidence"].iterdir()),[])
        self.assertEqual(self.ports.admitted,{})

    def test_wall_and_elapsed_clock_reversal_are_refused(self):
        for field in ("wall_ns","monotonic_ns"):
            clock=f.ClockEpoch();sample=clock.sample()
            clock.previous=replace(sample,**{field:getattr(sample,field)+10*a.NS})
            with self.assertRaisesRegex(a.AdapterError,"clock-reversal"):clock.sample()

    def test_process_capability_epoch_hashes_and_confirmed_horizon_are_checked(self):
        result=self.record();lease=self.acquire()
        try:
            read=self.ports.independent_admission_read(self.registry.scope,"event0",max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
            marker=a.decode(read.raw)
            for changed in (dict(document_sha256="a"*64),dict(verification_sha256="a"*64),dict(admission_sha256="a"*64),
                            dict(epoch="another_clock"),dict(confirmed=replace(read.confirmed,wall_ns=a.parse_ns(marker["wall_deadline"])))):
                with patch.object(self.ports,"independent_admission_read",return_value=replace(read,**changed)):
                    with self.assertRaises(a.AdapterError):self.adapter.verify_durable_readback(result["record"])
            self.clock.process_epoch="another_process"
            with self.assertRaisesRegex(a.AdapterError,"epoch"):
                self.ports.independent_admission_read(self.registry.scope,"event0",max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
        finally:lease.close()

    def test_duplicate_json_keys_and_unknown_event_fields_refuse_direct_append(self):
        result=self.record();lease=self.acquire()
        try:
            duplicate=result["record"].replace(b'"state":"present"',b'"state":"present","state":"present"')
            extra=a.canonical(dict(a.parse_record(result["record"]),unknown=True))
            for raw in (duplicate,extra):
                with self.assertRaises(a.AdapterError):self.ports.append(self.registry.scope,"event0",raw,a.sha(result["record"]),budget_ns=self.config.callback_budget_ns)
            artifact=a.decode(result["verification"]);artifact["unknown"]=True
            bad=a.canonical(artifact)
            (self.dirs["journal"]/"verify_event0").write_bytes(bad)
            proposal=a.decode(result["admission"])
            proposal.pop("prepared");proposal.pop("prepared_monotonic_ns")
            proposal["profile"]="publication-input-storage-admission-v2"
            proposal["verification_sha256"]=a.sha(bad)
            with self.assertRaises(a.AdapterError):self.ports._check_admission(self.registry.scope,"event0",proposal,self.config.callback_budget_ns)
        finally:lease.close()

    def test_generated_multichunk_source_is_hashed_with_explicit_eof(self):
        generated=self.entry("retained","scene","generated.bin",b"x"*(2*1024*1024+3))
        registry=replace(self.registry,payloads=(generated,))
        permit=replace(self.permits[0],original_identity=v1.identity(registry.original()))
        owner=self.owner(registry=registry,permits=(permit,));adapter=a.StorageAdapter(self.config,owner)
        result=owner.record_present(adapter,operation="operation0",event_id="large")
        self.assertEqual(a.admit_request(a.parse_record(result["record"])["request"].encode())["original"]["payloads"][0]["bytes"],2*1024*1024+3)
        self.assertEqual(a.sha((self.dirs["retained"]/generated.name).read_bytes()),generated.sha256)

    def test_nonregular_fifo_and_released_lease_are_refused(self):
        with self.assertRaisesRegex(a.AdapterError,"lease-required"):
            self.ports.independent_read(self.registry.scope,"event0",max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns)
        path=self.dirs["retained"]/self.payload.name
        path.unlink();os.mkfifo(path,0o600)
        with self.assertRaises(a.AdapterError):self.ports.stream_state(self.registry.scope,"master",budget_ns=self.config.callback_budget_ns)

    def test_missing_verification_after_confirmation_stops_current_projection(self):
        self.record()
        (self.dirs["journal"]/"verify_event0").unlink()
        with self.assertRaises(a.AdapterError):self.ports.verify_present(self.adapter,operation="operation0",event_id="event0")


if __name__=="__main__":unittest.main()
