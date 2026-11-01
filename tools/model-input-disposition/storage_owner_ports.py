"""Descriptor-backed prospective present observation; no transport or mutation.

All filesystem locations and qualification assertions are supplied capabilities.
No path, host, credential, installer or retrospective receipt discovery exists.
V3 admission is process-local: provisional disk bytes alone never admit anything.
"""
from dataclasses import dataclass, replace
import base64
import array
import fcntl
import hashlib
import json
from functools import wraps
import os
import selectors
import signal
import socket
import stat
import struct
import subprocess
import sys
import time
import uuid

import disposition as v1
import storage_adapter as a


FIELDS = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
FRAME_LIMIT = 2 * 1024 * 1024
MAX_ENTRIES = 3 * a.MAX_RECORDS + 1


def need(condition, code):
    a.need(condition, "filesystem-" + code)


def basename(value):
    need(type(value) is str and 0 < len(value) <= 128 and value not in (".", "..") and
         all(c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-" for c in value)
         and value[0].isalnum(), "entry")
    return value


# Fixed trusted worker; no shell, network, source import, caller code or locator
# output. A reader opens the entry itself and retains its descriptor for streams.
# Parent bounds every frame and deadline and kills/reaps its own process only.
_WORKER = r'''
import os,sys,json,struct,stat,base64,fcntl,socket,array,time,hashlib
root=int(sys.argv[1]); control=int(sys.argv[2]); lock=None; opened=None
fields=("st_dev","st_ino","st_mode","st_uid","st_gid","st_nlink","st_size","st_mtime_ns","st_ctime_ns")
def take(n):
 b=b""
 while len(b)<n:
  x=os.read(0,n-len(b))
  if not x: raise EOFError()
  b+=x
 return b
def emit(raw):
 out=struct.pack(">I",len(raw))+raw
 while out:
  n=os.write(1,out);out=out[n:]
def name(s):
 if type(s)!=str or not 0<len(s)<=128 or s in (".","..") or not s[0].isalnum() or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-" for c in s):raise ValueError()
 return s
def openfile(s,write=False):
 fd=os.open(name(s),(os.O_WRONLY|os.O_CREAT|os.O_EXCL if write else os.O_RDONLY)|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,0o600,dir_fd=root)
 if not stat.S_ISREG(os.fstat(fd).st_mode):os.close(fd);raise ValueError()
 return fd
try:
 while True:
  n=struct.unpack(">I",take(4))[0]
  if n>2097152:raise ValueError()
  q=json.loads(take(n));op=q["op"]
  try:
   if op=="root":
    out=json.dumps([getattr(os.fstat(root),k) for k in fields]).encode()
   elif op=="lock":
    if lock is not None:raise ValueError()
    candidate=os.open(name(q["name"]),os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=root)
    try:
     st=os.fstat(candidate)
     if not stat.S_ISREG(st.st_mode) or [getattr(st,k) for k in fields]!=q["expected"] or (st.st_uid,st.st_gid,stat.S_IMODE(st.st_mode),st.st_nlink)!=tuple(q["owner"]):raise ValueError()
     fcntl.flock(candidate,fcntl.LOCK_EX|fcntl.LOCK_NB)
     lock=candidate;candidate=None;out=b""
     if control<0:raise ValueError()
     channel=socket.socket(fileno=control)
     channel.sendmsg([b"L"],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array("i",[lock]))])
     channel.close();control=-1
    finally:
     if candidate is not None:os.close(candidate)
   elif op=="list":
    entries=[]
    with os.scandir(root) as iterator:
     for entry in iterator:
      entries.append(entry.name)
      if len(entries)>769:raise ValueError()
    out=json.dumps(sorted(entries)).encode()
   elif op in ("stat","read","open"):
    fd=openfile(q["name"])
    try:
     before=[getattr(os.fstat(fd),k) for k in fields]
     if "owner" in q and (before[3],before[4],stat.S_IMODE(before[2]),before[5])!=tuple(q["owner"]):raise ValueError()
     if "expected" in q and before!=q["expected"]:raise ValueError()
     if op=="open":
      if opened is not None:raise ValueError()
      opened=fd;fd=None;out=json.dumps(before).encode()
     elif op=="stat":out=json.dumps(before).encode()
     else:
      limit=q["limit"]
      if type(limit)!=int or not 0<=limit<=1048576:raise ValueError()
      data=bytearray()
      while len(data)<=limit:
       chunk=os.read(fd,min(65536,limit+1-len(data)))
       if not chunk:break
       data.extend(chunk)
      if len(data)>limit or before!=[getattr(os.fstat(fd),k) for k in fields]:raise ValueError()
      out=bytes(data)
    finally:
     if fd is not None:os.close(fd)
   elif op=="chunk":
    limit=q["limit"]
    if opened is None or type(limit)!=int or not 0<limit<=1048576:raise ValueError()
    out=os.read(opened,limit)
   elif op=="stream_stat":
    if opened is None:raise ValueError()
    out=json.dumps([getattr(os.fstat(opened),k) for k in fields]).encode()
   elif op=="write":
    data=base64.b64decode(q["data"],validate=True)
    if len(data)>262144:raise ValueError()
    grant=q["grant"];wall=time.time_ns();elapsed=time.monotonic_ns()
    if (grant["kind"],grant["state"],grant["phase"])!=("disposition","present","observation") or grant["target"] not in grant["allowed_targets"]:raise ValueError()
    if not grant["not_before"]<=wall<grant["expires"] or wall<grant["sampled_wall"] or not grant["sampled_elapsed"]<=elapsed<grant["elapsed_deadline"]:raise ValueError()
    if hashlib.sha256(data).hexdigest()!=q["sha256"]:raise ValueError()
    fd=openfile(q["name"],True)
    try:
     while data:
      n=os.write(fd,data)
      if n<=0:raise ValueError()
      data=data[n:]
     os.fsync(fd)
    finally:os.close(fd)
    os.fsync(root);out=b""
   elif op=="close":
    if opened is not None:os.close(opened);opened=None
    emit(b"+");break
   else:raise ValueError()
   emit(b"+"+out)
  except Exception:emit(b"!")
except Exception:pass
finally:
 if opened is not None:os.close(opened)
 if lock is not None:os.close(lock)
'''


def bounded_port(method):
    @wraps(method)
    def invoke(self, *args, **kwargs):
        owner = self.owner if isinstance(self, Stream) else self
        budget = kwargs.get("budget_ns", owner.config.callback_budget_ns)
        need(type(budget) is int and 0 < budget <= 60*a.NS, "io-budget")
        previous = owner.deadline
        owner.deadline = min(time.monotonic_ns()+budget, previous) if previous is not None else time.monotonic_ns()+budget
        try:
            result = method(self, *args, **kwargs)
            need(time.monotonic_ns() < owner.deadline, "callback-timeout")
            return result
        except Exception:
            if time.monotonic_ns() >= owner.deadline:owner._poison()
            raise
        finally:owner.deadline=previous
    return invoke


class _OwnedDescription:
    def __init__(self, fd):
        self.fd=fd;self.installed=False

    def close(self):
        if self.fd is None:return
        fd=self.fd;self.fd=None
        os.close(fd)


class _Child:
    """Bounded owned local process. Timeout is uncertainty, not cancellation proof."""
    def __init__(self, root_fd, poison, script=None, *, keeper=False, held_fd=None):
        self.poison = poison
        self.pending_descriptions=[]
        parent,child=socket.socketpair() if keeper else (None,None)
        self.control=parent
        passed=[root_fd]
        if child is not None:passed.append(child.fileno())
        if held_fd is not None:passed.append(held_fd)
        try:
            self.p = subprocess.Popen([sys.executable, "-I", "-B", "-S", "-c", _WORKER if script is None else script,
                                       str(root_fd),str(child.fileno() if child is not None else -1)],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, close_fds=True,
                                      pass_fds=tuple(passed), env={"LANG":"C"}, start_new_session=True)
        except Exception:
            if parent is not None:parent.close()
            raise
        finally:
            if child is not None:child.close()
        os.set_blocking(self.p.stdin.fileno(), False)
        os.set_blocking(self.p.stdout.fileno(), False)
        self.closed = False

    def take_lock(self, budget_ns):
        need(self.control is not None,"lock-transfer")
        try:
            self.control.settimeout(budget_ns/a.NS)
            raw,ancillary,flags,_=self.control.recvmsg(1,socket.CMSG_SPACE(4*array.array("i").itemsize))
            malformed=False
            for level,kind,data in ancillary:
                if level==socket.SOL_SOCKET and kind==socket.SCM_RIGHTS:
                    values=array.array("i");width=values.itemsize
                    values.frombytes(data[:len(data)-len(data)%width])
                    self.pending_descriptions.extend(_OwnedDescription(fd) for fd in values)
                    malformed=malformed or len(data)%width!=0
                else:malformed=True
            need(not malformed and raw==b"L" and not flags and len(self.pending_descriptions)==1,"lock-transfer")
            description=self.pending_descriptions[0]
            if description.fd<=2:
                replacement=_OwnedDescription(fcntl.fcntl(description.fd,fcntl.F_DUPFD_CLOEXEC,3))
                self.pending_descriptions.append(replacement)
                description.close();self.pending_descriptions.remove(description);description=replacement
            os.set_inheritable(description.fd,False)
            return description
        except Exception:
            self.poison()
            raise a.AdapterError("filesystem-lock-transfer") from None
        finally:
            # A timed-out unread SCM_RIGHTS message can itself hold the flock.
            # Retain its socket until keeper termination is established; once
            # rights are received their explicit owned handles retain it instead.
            if self.pending_descriptions and self.control is not None:
                self.control.close();self.control=None

    def exchange(self, request, *, limit, budget_ns):
        need(not self.closed and type(limit) is int and 0 <= limit <= FRAME_LIMIT and
             type(budget_ns) is int and 0 < budget_ns <= 60*a.NS, "io-budget")
        encoded=a.canonical(request)
        need(len(encoded)<=FRAME_LIMIT, "io-limit")
        pending=struct.pack(">I",len(encoded))+encoded
        output=bytearray(); expected=None; deadline=time.monotonic_ns()+budget_ns
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(self.p.stdin,selectors.EVENT_WRITE)
                selector.register(self.p.stdout,selectors.EVENT_READ)
                while True:
                    remaining=deadline-time.monotonic_ns()
                    need(remaining>0,"io-timeout")
                    for key,_ in selector.select(remaining/a.NS):
                        if key.fileobj is self.p.stdin:
                            count=os.write(self.p.stdin.fileno(),pending)
                            pending=pending[count:]
                            if not pending:selector.unregister(self.p.stdin)
                        else:
                            chunk=os.read(self.p.stdout.fileno(),min(65536,limit+6-len(output)))
                            need(bool(chunk),"io-short")
                            output.extend(chunk)
                            need(len(output)<=limit+5,"io-output")
                            if len(output)>=4 and expected is None:
                                expected=struct.unpack(">I",output[:4])[0]
                                need(1<=expected<=limit+1,"io-output")
                            if expected is not None and len(output)>=expected+4:
                                need(len(output)==expected+4 and output[4:5]==b"+","io-refused")
                                return bytes(output[5:])
        except Exception:
            self.poison()
            self.abort(min(50_000_000,max(0,deadline-time.monotonic_ns())))
            raise a.AdapterError("filesystem-io-uncertain") from None

    def abort(self, cleanup_ns=50_000_000):
        deadline=time.monotonic_ns()+cleanup_ns
        try:
            if not self.closed:
                self.closed=True
                self.p.kill()
            self.p.wait(timeout=max(0,deadline-time.monotonic_ns())/a.NS)
        except (OSError,subprocess.TimeoutExpired):
            self.poison()
        finally:
            self.p.stdin.close();self.p.stdout.close()
            if self.p.poll() is not None:
                if self.control is not None:self.control.close();self.control=None
                for description in self.pending_descriptions:
                    if not description.installed:description.close()

    def close(self, budget_ns):
        if self.closed:
            self.abort(min(50_000_000,budget_ns));return
        deadline=time.monotonic_ns()+budget_ns
        try:
            self.exchange({"op":"close"},limit=0,budget_ns=budget_ns)
            remaining=deadline-time.monotonic_ns()
            need(remaining>0,"close-timeout")
            self.p.wait(timeout=remaining/a.NS)
        except Exception:
            self.poison()
            raise a.AdapterError("filesystem-close-uncertain") from None
        finally:self.abort(min(50_000_000,max(0,deadline-time.monotonic_ns())))


@dataclass(frozen=True)
class Requirements:
    uid: int
    gid: int
    mode: int
    links: int = 1

    def __post_init__(self):
        need(all(type(v) is int and 0<=v<=v1.MAX_COUNT for v in (self.uid,self.gid,self.mode,self.links)) and
             self.mode<=0o777 and self.links==1,"requirements")

    def check(self, fields, directory=False):
        need(type(fields) is tuple and len(fields)==9 and all(type(v) is int for v in fields),"stat")
        need((stat.S_ISDIR(fields[2]) if directory else stat.S_ISREG(fields[2])) and
             (fields[3],fields[4],stat.S_IMODE(fields[2]))==(self.uid,self.gid,self.mode) and
             (directory or fields[5]==self.links),"ownership")


@dataclass(frozen=True)
class Entry:
    token: str
    name: str
    fields: tuple
    sha256: str
    requirements: Requirements

    def __post_init__(self):
        a.token(self.token);basename(self.name);a.digest(self.sha256)
        need(type(self.requirements) is Requirements,"requirements")
        self.requirements.check(self.fields)
        need(0<=self.fields[6]<=v1.MAX_COUNT,"size")


@dataclass(frozen=True)
class LockCapability:
    directory_fd: int
    entry: Entry

    def __post_init__(self):
        need(type(self.directory_fd) is int and self.directory_fd>2 and type(self.entry) is Entry,"lock-capability")


@dataclass(frozen=True)
class PrivateRoots:
    journal_dir_fd: int
    evidence_dir_fd: int
    registry_dir_fd: int
    retained_payload_dir_fd: int
    lock: LockCapability
    directory_requirements: Requirements
    file_requirements: Requirements
    cooperating_namespace_exclusive: bool
    retained_backing_immutable: bool


@dataclass(frozen=True)
class FrozenRegistry:
    scope: str
    owner: str
    provenance: str
    label: str
    manifest: Entry
    exact_manifest: bytes
    payloads: tuple
    protected: tuple
    generation: int

    def __post_init__(self):
        for value in (self.scope,self.owner,self.provenance,self.label):a.token(value)
        need(type(self.exact_manifest) is bytes and len(self.exact_manifest)<=a.MAX_BYTES and
             a.sha(self.exact_manifest)==self.manifest.sha256 and len(self.exact_manifest)==self.manifest.fields[6],"manifest")
        need(type(self.payloads) is tuple and 0<len(self.payloads)<=128 and
             all(type(x) is Entry for x in self.payloads) and
             [x.token for x in self.payloads]==sorted({x.token for x in self.payloads}) and
             len({x.name for x in self.payloads})==len(self.payloads) and
             self.manifest.name not in {x.name for x in self.payloads},"payloads")
        need(type(self.protected) is tuple and len(self.protected)==3 and
             all(type(x) is Entry for x in self.protected) and
             tuple(x.token for x in self.protected)==("application","selection","policy"),"protected")
        need(type(self.generation) is int and 0<=self.generation<=v1.MAX_COUNT,"generation")

    def original(self):
        return {"manifest":{"sha256":self.manifest.sha256,"bytes":len(self.exact_manifest)},
                "payloads":[{"name":p.token,"sha256":p.sha256,"bytes":p.fields[6]} for p in self.payloads]}


@dataclass(frozen=True)
class OperationPermit:
    scope: str
    owner: str
    operation: str
    original_identity: str
    epoch: str
    issuer: str
    not_before_ns: int
    expires_ns: int
    allowed_targets: tuple

    def __post_init__(self):
        for value in (self.scope,self.owner,self.operation,self.epoch,self.issuer):a.token(value)
        a.digest(self.original_identity)
        need(type(self.not_before_ns) is int and type(self.expires_ns) is int and
             self.not_before_ns<self.expires_ns and self.allowed_targets==("journal","evidence"),"permit")


class ClockEpoch:
    def __init__(self, source=None):
        self.source="epoch_"+uuid.uuid4().hex if source is None else source
        a.token(self.source)
        self.pid=os.getpid();self.previous=None;self.process_epoch="process_"+uuid.uuid4().hex

    def sample(self):
        need(os.getpid()==self.pid,"epoch")
        sample=a.ClockSample(time.time_ns(),time.monotonic_ns(),self.source)
        a.format_ns(sample.wall_ns)
        need(type(sample.monotonic_ns) is int and 0<=sample.monotonic_ns<2**63,"clock")
        if self.previous is not None:
            need(sample.wall_ns>=self.previous.wall_ns and sample.monotonic_ns>=self.previous.monotonic_ns,"clock-reversal")
        self.previous=sample
        return sample


class Stream:
    def __init__(self, owner, entry, budget_ns, max_chunks):
        self.owner,self.entry=owner,entry
        self.max_chunks=max_chunks
        self.child=owner._child(owner.roots.retained_payload_dir_fd)
        fields=tuple(json.loads(self.child.exchange({"op":"open","name":entry.name,"expected":entry.fields},limit=1024,budget_ns=owner._remaining(budget_ns))))
        need(fields==entry.fields,"backing")
        self.state=owner._state(entry)
        self.closed=False;self.total=0;self.chunks=0;self.hash=hashlib.sha256()

    @bounded_port
    def read_chunk(self, *, max_bytes, budget_ns):
        self.owner._held()
        need(not self.closed and type(max_bytes) is int and 0<max_bytes<=self.owner.config.stream_limits.chunk_bytes,"chunk")
        self.chunks+=1
        need(self.chunks<=self.max_chunks,"chunks")
        chunk=self.child.exchange({"op":"chunk","limit":max_bytes},limit=max_bytes,budget_ns=self.owner._remaining(budget_ns))
        self.total+=len(chunk);self.hash.update(chunk)
        need(self.total<=self.entry.fields[6],"stream-size")
        if not chunk:
            need(self.total==self.entry.fields[6] and self.hash.hexdigest()==self.entry.sha256,"stream-hash")
        return chunk

    @bounded_port
    def close(self):
        if self.closed:return
        self.closed=True
        try:
            fields=tuple(json.loads(self.child.exchange({"op":"stream_stat"},limit=1024,budget_ns=self.owner._remaining(self.owner.config.callback_budget_ns))))
            need(fields==self.entry.fields,"backing")
        finally:
            if self.owner.deadline is not None and time.monotonic_ns()>=self.owner.deadline:
                self.owner._poison();self.child.abort(0)
            else:self.child.close(self.owner._remaining(self.owner.config.callback_budget_ns))


class HeldLease:
    def __init__(self, owner, operation, child, description):
        self.owner,self.operation,self.child=owner,operation,child
        self.description=description
        self.closed=False

    @property
    def lock_fd(self):
        need(not self.closed and self.description.fd is not None,"stale-lease")
        return self.description.fd

    def snapshot(self):
        need(not self.closed and self.owner.lease is self,"stale-lease")
        return self.owner._fence()

    def close(self):
        if self.closed:return
        need(self.owner.lease is self,"stale-lease")
        self.owner._release(self)


class BorrowedLease:
    def __init__(self, held):
        self.held=held;self.closed=False

    def snapshot(self):
        need(not self.closed,"stale-lease")
        return self.held.snapshot()

    def close(self):
        if self.closed:return
        owner=self.held.owner
        need(owner.lease is self.held and not self.held.closed,"stale-lease")
        self.closed=True;owner.borrowed=False


class FilesystemObservationPorts:
    """Same-host independently executed readback, never another failure domain.

    Qualification of supplied permits, immutable backing and cooperating actor
    coverage remains external. This class neither discovers nor grants them.
    """
    def __init__(self, roots, registry, permits, clock, config):
        need(type(roots) is PrivateRoots and type(registry) is FrozenRegistry and type(clock) is ClockEpoch,"configuration")
        need(type(config) is a.OwnerConfig and config.kinds==("disposition",) and config.stream_limits is not None and
             (config.scope,config.owner,config.registry_provenance,config.clock_source)==
             (registry.scope,registry.owner,registry.provenance,clock.source),"configuration")
        need(roots.cooperating_namespace_exclusive is True and roots.retained_backing_immutable is True,"coverage")
        need(sum(p.fields[6] for p in registry.payloads)<=config.stream_limits.max_source_bytes and
             all(p.fields[6]<=config.stream_limits.max_payload_bytes for p in registry.payloads) and
             sum((p.fields[6]+config.stream_limits.chunk_bytes-1)//config.stream_limits.chunk_bytes+1 for p in registry.payloads)<=config.stream_limits.max_chunks,"stream-admission")
        need(type(permits) is tuple and all(type(p) is OperationPermit for p in permits) and
             len({p.operation for p in permits})==len(permits),"permits")
        need(type(roots.file_requirements) is Requirements and type(roots.directory_requirements) is Requirements and
             (roots.file_requirements.uid,roots.file_requirements.gid)==(os.geteuid(),os.getegid()) and
             roots.file_requirements.mode==0o600,"writer-identity")
        need(type(roots.lock) is LockCapability,"lock-capability")
        supplied=(roots.journal_dir_fd,roots.evidence_dir_fd,roots.registry_dir_fd,roots.retained_payload_dir_fd,roots.lock.directory_fd)
        need(all(type(fd) is int and fd>2 for fd in supplied),"descriptor")
        duplicated=[]
        try:
            for fd in supplied:duplicated.append(fcntl.fcntl(fd,fcntl.F_DUPFD_CLOEXEC,3))
        except Exception:
            for fd in duplicated:os.close(fd)
            raise a.AdapterError("filesystem-descriptor-duplication") from None
        roots=replace(roots,journal_dir_fd=duplicated[0],evidence_dir_fd=duplicated[1],registry_dir_fd=duplicated[2],
                      retained_payload_dir_fd=duplicated[3],lock=LockCapability(duplicated[4],roots.lock.entry))
        self.roots,self.registry,self.clock,self.config=roots,registry,clock,config
        self._owned_fds=tuple(duplicated);self._root_ids={};self.closed=False
        self.permits={p.operation:p for p in permits};self.pid=os.getpid()
        self.lease=None;self.pending_keeper=None;self.borrowed=False;self.borrow_available=False;self.borrow_alias=False;self.failed=False
        self.admitted={};self.references={};self.children=[];self.observations={};self.deadline=None
        try:
            for fd in self._owned_fds:self._io(fd,{"op":"root"},1024,config.callback_budget_ns)
            need(len({self._root_ids[fd][:2] for fd in self._owned_fds[:4]})==4,"root-alias")
        except Exception:
            for child in self.children:child.abort()
            for fd in self._owned_fds:os.close(fd)
            self._owned_fds=();self.closed=True
            raise

    def _poison(self):self.failed=True

    def _valid(self):need(os.getpid()==self.pid and not self.failed and not self.closed,"uncertain-or-restarted")

    def _held(self):
        self._valid();need(self.lease is not None,"lease-required")
        if self.lease.child.p.poll() is not None:
            self._poison();raise a.AdapterError("filesystem-lease-keeper-lost")

    def _child(self, root, *, lock_keeper=False):
        need(root in self._owned_fds,"unowned-descriptor")
        self.children=[c for c in self.children if c.p.poll() is None]
        need(len(self.children)<64,"children-limit")
        if self.lease is not None:self._held()
        child=_Child(root,self._poison,keeper=lock_keeper,
                     held_fd=self.lease.lock_fd if self.lease is not None else None)
        self.children.append(child)
        try:
            fields=tuple(json.loads(child.exchange({"op":"root"},limit=1024,budget_ns=self._remaining(self.config.callback_budget_ns))))
            self.roots.directory_requirements.check(fields,True)
            identity=fields[:5]
            need(root not in self._root_ids or self._root_ids[root]==identity,"root-identity")
            self._root_ids[root]=identity
        except Exception:
            self._poison();child.abort(0 if self.deadline is not None and time.monotonic_ns()>=self.deadline else 50_000_000)
            raise
        return child

    def _remaining(self, budget_ns):
        remaining=budget_ns if self.deadline is None else min(budget_ns,self.deadline-time.monotonic_ns())
        need(remaining>0,"callback-timeout")
        return remaining

    def _io(self, root, command, limit, budget_ns):
        self._valid()
        child=self._child(root)
        try:
            if command["op"]=="write":
                command=dict(command,grant=self._write_authorization(root))
            return child.exchange(command,limit=limit,budget_ns=self._remaining(budget_ns))
        finally:
            if self.deadline is not None and time.monotonic_ns()>=self.deadline:
                self._poison();child.abort(0)
            else:child.close(self._remaining(budget_ns))

    def _read(self, root, name, limit, budget_ns, expected=None):
        command={"op":"read","name":basename(name),"limit":limit}
        if expected is not None:command["expected"]=expected
        if root in (self.roots.journal_dir_fd,self.roots.evidence_dir_fd):
            req=self.roots.file_requirements
            command["owner"]=[req.uid,req.gid,req.mode,req.links]
        return self._io(root,command,limit,budget_ns)

    def _entry(self, root, entry, budget_ns):
        fields=tuple(json.loads(self._io(root,{"op":"stat","name":entry.name},1024,budget_ns)))
        entry.requirements.check(fields);need(fields==entry.fields,"backing")
        return fields

    def _write(self, root, name, raw, budget_ns):
        self._held();need(type(raw) is bytes and len(raw)<=a.MAX_BYTES,"write-limit")
        self._write_authorization(root)
        self._io(root,{"op":"write","name":basename(name),"data":base64.b64encode(raw).decode("ascii"),"sha256":a.sha(raw)},0,budget_ns)
        actual=self._read(root,name,a.MAX_BYTES,budget_ns)
        need(actual==raw,"write-readback")
        return a.WriteAck(self.config.write_route,True)

    def _write_authorization(self, root):
        self._held()
        permit=self._permit(self.lease.operation)
        target="journal" if root==self.roots.journal_dir_fd else "evidence" if root==self.roots.evidence_dir_fd else None
        need(target in permit.allowed_targets,"write-target")
        now=self.clock.sample()
        need(permit.not_before_ns<=now.wall_ns<permit.expires_ns,"authorization")
        elapsed=now.monotonic_ns+permit.expires_ns-now.wall_ns
        if self.deadline is not None:elapsed=min(elapsed,self.deadline)
        return {"scope":permit.scope,"owner":permit.owner,"operation":permit.operation,"original":permit.original_identity,
                "epoch":permit.epoch,"issuer":permit.issuer,"target":target,"allowed_targets":permit.allowed_targets,
                "kind":"disposition","state":"present","phase":"observation","not_before":permit.not_before_ns,
                "expires":permit.expires_ns,"sampled_wall":now.wall_ns,"sampled_elapsed":now.monotonic_ns,"elapsed_deadline":elapsed}

    def _permit(self, operation):
        self._valid();a.token(operation)
        permit=self.permits.get(operation);now=self.clock.sample()
        need(permit is not None and (permit.scope,permit.owner,permit.epoch,permit.issuer,permit.original_identity)==
             (self.registry.scope,self.registry.owner,self.clock.source,self.registry.provenance,v1.identity(self.registry.original())) and
             permit.not_before_ns<=now.wall_ns<permit.expires_ns,"authorization")
        return permit

    @bounded_port
    def now(self, *, budget_ns):
        self._valid();return self.clock.sample()

    @bounded_port
    def authorize(self, scope, operation, kind, mode, *, budget_ns):
        self._permit(operation)
        return (scope,kind,mode)==(self.registry.scope,"disposition","observation")

    @bounded_port
    def try_acquire(self, scope, operation, *, budget_ns):
        need(scope==self.registry.scope,"scope")
        if self.lease is not None:
            self._permit(self.lease.operation)
            need(self.borrow_available and not self.borrowed and
                 (self.lease.operation==operation or (operation=="read_projection" and self.borrow_alias)),"nested-lock")
            self.borrow_available=False;self.borrowed=True;return BorrowedLease(self.lease)
        self._permit(operation)
        child=None;held=None
        try:
            need(self.pending_keeper is None,"pending-acquisition")
            child=self._child(self.roots.lock.directory_fd,lock_keeper=True)
            self.pending_keeper=child
            req=self.roots.file_requirements
            lock=self.roots.lock.entry
            need(lock.requirements==req,"lock-ownership")
            child.exchange({"op":"lock","name":lock.name,"expected":lock.fields,"owner":[req.uid,req.gid,req.mode,req.links]},
                           limit=0,budget_ns=self._remaining(budget_ns))
            description=child.take_lock(self._remaining(budget_ns))
            held=HeldLease(self,operation,child,description)
            self.lease=held;description.installed=True;self.pending_keeper=None
            anchor=a.canonical({"profile":"filesystem-observation-scope-v1","scope":scope,"owner":self.registry.owner,
                                "epoch":self.clock.source,"process_epoch":self.clock.process_epoch,"original":v1.identity(self.registry.original())})
            names=json.loads(self._io(self.roots.journal_dir_fd,{"op":"list"},65536,budget_ns))
            self.anchor=anchor
            if not names:self._write(self.roots.journal_dir_fd,"scope",anchor,budget_ns)
            else:need("scope" in names and self._read(self.roots.journal_dir_fd,"scope",a.MAX_BYTES,budget_ns)==anchor,"epoch-or-frontier")
            self._fence()
            return self.lease
        except BaseException:
            self._poison()
            try:
                if held is not None and self.lease is held:
                    held.description.installed=True;self.pending_keeper=None
                    self._release(held)
                elif child is not None:
                    self.pending_keeper=child
                    remaining=0 if self.deadline is None else max(0,self.deadline-time.monotonic_ns())
                    child.abort(min(50_000_000,remaining))
                    if child.p.poll() is not None:
                        child.abort(0)
                        if child.control is None and all(d.fd is None for d in child.pending_descriptions):self.pending_keeper=None
            except Exception:self._poison()
            raise

    def _release(self, expected=None):
        lease=self.lease
        if lease is None:return
        need(expected is None or expected is lease,"stale-lease")
        if self.borrowed:
            self._poison()
            if sys.exc_info()[0] is None:raise a.AdapterError("filesystem-borrowed-lease-active")
            return
        if any(c is not lease.child and c.p.poll() is None for c in self.children):
            self._poison()
            if sys.exc_info()[0] is None:raise a.AdapterError("filesystem-unreaped-child")
            return
        original=sys.exc_info()[0] is not None
        try:
            # Never restart the acquisition deadline and never issue LOCK_UN:
            # the parent's specific description retains the actual lock until
            # keeper termination AND all owned helper termination are known.
            lease.child.close(self._remaining(self.config.callback_budget_ns))
        except Exception:
            self._poison()
            if not original:raise
        finally:
            if lease.child.p.poll() is not None:
                lease.description.close()
                lease.closed=True;self.lease=None
                self.borrowed=self.borrow_available=self.borrow_alias=False

    def close(self):
        """Close only owned duplicates after actual child/lease termination."""
        if self.closed:return
        need(os.getpid()==self.pid,"epoch")
        deadline=self.deadline if self.deadline is not None else time.monotonic_ns()+self.config.callback_budget_ns
        if self.pending_keeper is not None:
            child=self.pending_keeper
            child.abort(min(50_000_000,max(0,deadline-time.monotonic_ns())))
            if child.p.poll() is not None:child.abort(0)
            if child.p.poll() is None or child.control is not None or any(d.fd is not None and not d.installed for d in child.pending_descriptions):
                self._poison();raise a.AdapterError("filesystem-unreaped-child")
            self.pending_keeper=None
        if self.lease is not None and self.lease.child.p.poll() is not None:
            self.lease.description.close()
            self.lease.closed=True;self.lease=None
        if self.lease is not None:self._release(self.lease)
        if self.lease is not None or any(c.p.poll() is None for c in self.children):
            self._poison();raise a.AdapterError("filesystem-unreaped-child")
        for fd in self._owned_fds:os.close(fd)
        self._owned_fds=();self.closed=True

    @bounded_port
    def _fence(self):
        self._held();self._permit(self.lease.operation)
        pins=[]
        for entry in self.registry.protected:
            self._entry(self.roots.registry_dir_fd,entry,self.config.callback_budget_ns)
            raw=self._read(self.roots.registry_dir_fd,entry.name,a.MAX_BYTES,self.config.callback_budget_ns,entry.fields)
            need(a.sha(raw)==entry.sha256,"protected-state")
            pins.append(entry.sha256)
        return a.Fence(self.registry.generation,self.lease.operation,*pins,False)

    def _state(self, entry):
        return a.StreamState(a.sha(a.canonical(list(entry.fields))),self.config.read_route,True,True)

    @bounded_port
    def frozen_export(self, scope, *, budget_ns):
        self._valid();need(scope==self.registry.scope,"scope")
        self._entry(self.roots.retained_payload_dir_fd,self.registry.manifest,budget_ns)
        raw=self._read(self.roots.retained_payload_dir_fd,self.registry.manifest.name,a.MAX_BYTES,budget_ns,self.registry.manifest.fields)
        need(raw==self.registry.exact_manifest,"manifest")
        payloads=tuple(a.StreamPayload(p.token,p.token,p.fields[6],p.sha256,self._state(p).sha256) for p in self.registry.payloads)
        return a.FrozenExport(a.StreamingSource(raw,payloads),None,self.registry.label,self.registry.provenance,True)

    def _payload(self, handle):
        a.token(handle)
        matches=[p for p in self.registry.payloads if p.token==handle]
        need(len(matches)==1,"unregistered")
        return matches[0]

    @bounded_port
    def stream_state(self, scope, handle, *, budget_ns):
        self._valid();need(scope==self.registry.scope,"scope")
        entry=self._payload(handle);self._entry(self.roots.retained_payload_dir_fd,entry,budget_ns)
        return self._state(entry)

    @bounded_port
    def open_stream(self, scope, handle, *, expected_state, max_bytes, max_chunks, budget_ns):
        self._held();need(scope==self.registry.scope,"scope")
        entry=self._payload(handle)
        need(self._state(entry).sha256==expected_state and entry.fields[6]<=max_bytes<=self.config.stream_limits.max_payload_bytes and
             type(max_chunks) is int and 0<max_chunks<=self.config.stream_limits.max_chunks,"stream-admission")
        return Stream(self,entry,budget_ns,max_chunks)

    def _event(self, raw):
        event=a.parse_record(raw)
        doc=a.admit_request(event["request"].encode("ascii"))
        self._permit(event["operation"])
        need((event["scope"],event["owner"],event["kind"],event["state"],event["phase"],event["mode"],event["clock_source"])==
             (self.registry.scope,self.registry.owner,"disposition","present","observation","observation",self.clock.source) and
             doc["release"] is None and doc["label"]==self.registry.label and doc["original"]==self.registry.original() and
             not event["prerequisite_proofs"],"observation-only")
        issued=self.observations.get(event["operation"])
        need(issued is not None and issued[0]==event["id"] and event["evidence"]==issued[1] and
             a.parse_ns(event["recorded"])>=issued[2],"unissued-observation")
        return event

    @bounded_port
    def ledger(self, scope, *, max_records, max_bytes, budget_ns):
        self._held();need(scope==self.registry.scope,"scope")
        names=json.loads(self._io(self.roots.journal_dir_fd,{"op":"list"},65536,budget_ns))
        need(type(names) is list and len(names)<=MAX_ENTRIES and "scope" in names and
             self._read(self.roots.journal_dir_fd,"scope",a.MAX_BYTES,budget_ns)==self.anchor,"frontier")
        events={};sidecars=[];total=0
        for name in names:
            if name=="scope":continue
            prefix,sep,event_id=name.partition("_")
            need(sep and prefix in ("event","verify","admit"),"orphan")
            a.token(event_id)
            if prefix!="event":sidecars.append(event_id);continue
            raw=self._read(self.roots.journal_dir_fd,name,a.MAX_BYTES,budget_ns)
            event=self._event(raw);need(event["id"]==event_id,"event-id")
            total+=len(raw);need(len(events)<max_records and total<=max_bytes,"ledger-limit")
            events[a.sha(raw)]=(event,raw)
        need(all(event_id in {e["id"] for e,_ in events.values()} for event_id in sidecars),"orphan")
        ordered=[];tail=None
        while len(ordered)<len(events):
            next_items=[(h,e,raw) for h,(e,raw) in events.items() if e["predecessors"]==([] if tail is None else [tail])]
            need(len(next_items)==1,"fork-or-orphan")
            tail,event,raw=next_items[0];ordered.append(raw)
        return a.LedgerSnapshot(tuple(ordered),tail,True,self.registry.provenance)

    @bounded_port
    def append(self, scope, key, raw, expected_tail, *, budget_ns):
        self._held();event=self._event(raw);a.token(key)
        need(scope==self.registry.scope and key==event["id"] and event["operation"]==self.lease.operation,"scope")
        snapshot=self.ledger(scope,max_records=a.MAX_RECORDS,max_bytes=a.MAX_LEDGER_BYTES,budget_ns=budget_ns)
        need(snapshot.tail==expected_tail and event["predecessors"]==([] if expected_tail is None else [expected_tail]),"tail-race")
        need(all(a.parse_record(r)["id"]!=key for r in snapshot.records),"duplicate")
        return self._write(self.roots.journal_dir_fd,"event_"+key,raw,budget_ns)

    @bounded_port
    def independent_read(self, scope, key, *, max_bytes, budget_ns):
        self._held();a.token(key);need(scope==self.registry.scope,"scope")
        raw=self._read(self.roots.journal_dir_fd,"event_"+key,max_bytes,budget_ns)
        self._event(raw)
        return a.Readback(raw,self.config.read_route,True,True)

    @bounded_port
    def append_verification(self, scope, key, raw, *, budget_ns):
        self._held();event_raw=self.independent_read(scope,key,max_bytes=a.MAX_BYTES,budget_ns=budget_ns).raw
        body=a.decode(raw);event=self._event(event_raw)
        need(event["operation"]==self.lease.operation,"operation")
        need(body.get("event")==key and body.get("operation")==event["operation"] and
             body.get("document",{}).get("sha256")==a.sha(event_raw),"verification")
        return self._write(self.roots.journal_dir_fd,"verify_"+key,raw,budget_ns)

    @bounded_port
    def independent_verification_read(self, scope, key, *, max_bytes, budget_ns):
        self._held();a.token(key);need(scope==self.registry.scope,"scope")
        return a.Readback(self._read(self.roots.journal_dir_fd,"verify_"+key,max_bytes,budget_ns),self.config.read_route,True,True)

    @bounded_port
    def resolve(self, scope, reference, *, max_bytes, budget_ns):
        self._held();a.token(reference);need(scope==self.registry.scope,"scope")
        entry=self.references.get(reference)
        need(entry is not None,"unissued-reference")
        expected,operation=entry;self._permit(operation)
        raw=self._read(self.roots.evidence_dir_fd,reference,max_bytes,budget_ns)
        need(raw==expected,"reference-rebound")
        body=a.decode(raw)
        need((body["operation"],body["kind"],body["state"],body["origin"],body["binding"])==
             (operation,"disposition","present","prospective",v1.identity(self.registry.original())),"reference-scope")
        return [a.ResolvedReference(raw,self.config.reference_routes[0],True,body["role"]=="readback")]

    def _check_admission(self, scope, key, proposal, budget_ns):
        self._held();a.token(key)
        raw=self.independent_read(scope,key,max_bytes=a.MAX_BYTES,budget_ns=budget_ns).raw
        event=self._event(raw);verification=self.independent_verification_read(scope,key,max_bytes=a.MAX_BYTES,budget_ns=budget_ns).raw
        need(all(proposal[name]==event[name] for name in ("scope","owner","operation","kind","mode","clock_source")) and
             proposal["wall_deadline"]==event["expires"] and
             a.StorageAdapter._decimal_ns(proposal["elapsed_deadline_ns"])==int(event["monotonic_ns"])+a.parse_ns(event["expires"])-a.parse_ns(event["captured"]) and
             event["operation"]==self.lease.operation and proposal["event"]==key and
             proposal["document_sha256"]==a.sha(raw) and proposal["verification_sha256"]==a.sha(verification) and
             proposal["fence"]==self._fence().object(),"admission-binding")
        snapshot=self.ledger(scope,max_records=a.MAX_RECORDS,max_bytes=a.MAX_LEDGER_BYTES,budget_ns=budget_ns)
        need(snapshot.tail==a.sha(raw),"admission-frontier")
        export=self.frozen_export(scope,budget_ns=budget_ns)
        streams={p.handle:{"name":p.name,"bytes":p.bytes,"sha256":p.sha256,"state_sha256":p.state_sha256,"route":self.config.read_route}
                 for p in export.original.payloads}
        for p in export.original.payloads:self.stream_state(scope,p.handle,budget_ns=budget_ns)
        registry=a.sha(a.canonical({"label":export.label,"original":self.registry.original(),"release":None,
                                   "provenance":export.provenance,"streams":streams}))
        need(proposal["registry_sha256"]==registry and proposal["stream_seals"]==streams,"admission-registry")
        artifact=a.decode(verification)
        a.keys(artifact,"profile event operation scope owner authority document original registry_sha256 fence recorded captured clock_source references streams limits")
        expected_document={"sha256":a.sha(raw),"bytes":len(raw),"write_route":self.config.write_route,
                           "read_route":self.config.read_route,"independent":True}
        need(artifact["profile"]=="publication-input-storage-verification-v2" and
             artifact["authority"]=="injected-owner-evidence" and artifact["document"]==expected_document and
             type(artifact["document"]["bytes"]) is int and artifact["document"]["independent"] is True and
             artifact["original"]==v1.identity(self.registry.original()) and
             all(artifact[name]==event[name] for name in ("operation","scope","owner","registry_sha256","fence","recorded","captured","clock_source")) and
             artifact["event"]==key and artifact["streams"]==streams and
             artifact["limits"]==["injected-routes-only","cooperating-writers-only","no-operational-adoption"],"verification")
        for source in (artifact["streams"],proposal["stream_seals"]):
            need(type(source) is dict and all(type(value) is dict and type(value.get("bytes")) is int
                                             for value in source.values()),"verification-count")
        checked=[]
        for ref in event["evidence"]:
            resolved=self.resolve(scope,ref["id"],max_bytes=a.MAX_BYTES,budget_ns=budget_ns)[0]
            body=a.decode(resolved.raw)
            need(a.sha(resolved.raw)==ref["sha256"] and body["binding"]==ref["binding"] and body["role"]==ref["role"],"reference-binding")
            checked.append({"id":ref["id"],"sha256":ref["sha256"],"bytes":len(resolved.raw),
                            "route":resolved.route,"binding":ref["binding"],"role":ref["role"],
                            "recorded":body["recorded"],"provenance":body["provenance"]})
        need(type(artifact["references"]) is list and artifact["references"]==checked and
             all(type(ref) is dict and type(ref.get("bytes")) is int for ref in artifact["references"]),"verification-references")
        now=self.clock.sample()
        need(a.parse_ns(proposal["validated"])<=now.wall_ns<a.parse_ns(proposal["wall_deadline"]) and
             a.StorageAdapter._decimal_ns(proposal["validated_monotonic_ns"])<=now.monotonic_ns<a.StorageAdapter._decimal_ns(proposal["elapsed_deadline_ns"]),"admission-expired")
        return raw,verification,now

    @bounded_port
    def commit_admission(self, scope, key, proposal, *, budget_ns):
        self._held();body=a.decode(proposal)
        a.keys(body,"profile event operation scope owner kind mode document_sha256 verification_sha256 registry_sha256 fence stream_seals clock_source validated validated_monotonic_ns wall_deadline elapsed_deadline_ns")
        need(body["profile"]=="publication-input-storage-admission-v2","admission-proposal")
        raw,verification,prepared=self._check_admission(scope,key,body,budget_ns)
        body=dict(body,profile="publication-input-observation-admission-v3",prepared=a.format_ns(prepared.wall_ns),
                  prepared_monotonic_ns=str(prepared.monotonic_ns))
        tentative=a.canonical(body)
        try:
            self._write(self.roots.journal_dir_fd,"admit_"+key,tentative,budget_ns)
            # All of these operations finish BEFORE the volatile confirmation.
            self._check_admission(scope,key,a.decode(proposal),budget_ns)
            actual=self._read(self.roots.journal_dir_fd,"admit_"+key,a.MAX_BYTES,budget_ns)
            need(actual==tentative,"admission-readback")
            self._check_admission(scope,key,a.decode(proposal),budget_ns)
            permit=self._permit(self.lease.operation)
            confirmed=self.clock.sample()
            need(permit.not_before_ns<=confirmed.wall_ns<permit.expires_ns,"authorization")
            need(confirmed.wall_ns<a.parse_ns(body["wall_deadline"]) and
                 confirmed.monotonic_ns<int(body["elapsed_deadline_ns"]),"admission-expired")
            self.admitted[key]=(a.sha(raw),a.sha(verification),a.sha(actual),confirmed,self.clock.process_epoch)
            return a.WriteAck(self.config.write_route,True)
        except Exception:
            self.admitted.pop(key,None);self._poison();raise

    @bounded_port
    def independent_admission_read(self, scope, key, *, max_bytes, budget_ns):
        self._held();a.token(key);need(scope==self.registry.scope and key in self.admitted,"admission-unconfirmed")
        document,verification,admission,confirmed,epoch=self.admitted[key]
        need(epoch==self.clock.process_epoch,"epoch")
        raw=self._read(self.roots.journal_dir_fd,"admit_"+key,max_bytes,budget_ns)
        need(a.sha(raw)==admission and a.sha(self.independent_read(scope,key,max_bytes=a.MAX_BYTES,budget_ns=budget_ns).raw)==document and
             a.sha(self.independent_verification_read(scope,key,max_bytes=a.MAX_BYTES,budget_ns=budget_ns).raw)==verification,"admission-rebound")
        self.clock.sample()
        return a.ProcessAdmissionReadback(raw,self.config.read_route,True,True,self.clock.source,epoch,confirmed,document,verification,admission)

    def dispatch_under_fence(self, *args, **kwargs):
        raise a.AdapterError("filesystem-mutation-unsupported")

    def independent_dispatch_boundary(self, *args, **kwargs):
        raise a.AdapterError("filesystem-settlement-unsupported")

    def _reference_ids(self, operation, event_id):
        self._valid();a.token(operation);a.token(event_id)
        ids={role:a.sha(a.canonical({"profile":"filesystem-observation-reference-v1",
             "scope":self.registry.scope,"owner":self.registry.owner,"operation":operation,
             "event":event_id,"role":role,"original":v1.identity(self.registry.original()),
             "clock_source":self.clock.source,"process_epoch":self.clock.process_epoch}))
             for role in ("outcome","persistence","readback")}
        for ref in ids.values():a.token(ref)
        need(len(set(ids.values()))==3,"reference-collision")
        return ids

    def record_present(self, adapter, *, operation, event_id):
        """One admitted lock acquisition; actual source reads + evidence writes.

        Intended only for a separately permitted prospective observation. Tests
        supply disposable roots. No mutation intent or settlement is invented.
        """
        need(type(adapter) is a.StorageAdapter and adapter.config==self.config,"adapter")
        reference_ids=self._reference_ids(operation,event_id)
        self._permit(operation)
        lease=self.try_acquire(self.registry.scope,operation,budget_ns=self.config.callback_budget_ns)
        need(not self.borrowed,"nested-lock")
        try:
            export=self.frozen_export(self.registry.scope,budget_ns=self.config.callback_budget_ns)
            remaining_chunks=self.config.stream_limits.max_chunks
            for pin in export.original.payloads:
                stream=self.open_stream(self.registry.scope,pin.handle,expected_state=pin.state_sha256,
                    max_bytes=self.config.stream_limits.max_payload_bytes,max_chunks=remaining_chunks,
                    budget_ns=self.config.callback_budget_ns)
                try:
                    while stream.read_chunk(max_bytes=self.config.stream_limits.chunk_bytes,budget_ns=self.config.callback_budget_ns):pass
                finally:stream.close()
                remaining_chunks-=stream.chunks
            self._fence()
            observed=self.clock.sample().wall_ns
            need(operation not in self.observations,"operation-reuse")
            refs=[]
            for role in ("outcome","persistence","readback"):
                sample=self.clock.sample()
                body=a.canonical(dict(profile=a.EVIDENCE_PROFILE,scope=self.registry.scope,owner=self.registry.owner,
                    operation=operation,kind="disposition",state="present",binding=v1.identity(self.registry.original()),role=role,
                    recorded=a.format_ns(sample.wall_ns),clock_source=self.clock.source,provenance=self.registry.provenance,
                    origin="prospective",cloud_status="not_applicable",carriers=[]))
                ref=reference_ids[role]
                need(ref not in self.references,"duplicate-reference")
                self._write(self.roots.evidence_dir_fd,ref,body,self.config.callback_budget_ns)
                self.references[ref]=(body,operation)
                refs.append({"id":ref,"sha256":a.sha(body),"binding":v1.identity(self.registry.original()),"role":role})
            request=a.canonical(dict(version=1,profile="publication-input-claims-v1",label=self.registry.label,
                                     original=self.registry.original(),release=None,events=[]))
            self.observations[operation]=(event_id,list(refs),observed)
            self.borrow_available=True
            result=adapter.record_observation(request,operation=operation,event_id=event_id,kind="disposition",state="present",references=tuple(refs))
            need(not self.borrowed,"borrowed-lease")
            return result
        except Exception:
            if event_id not in self.admitted:self._poison()
            raise
        finally:self._release(lease)

    def verify_present(self, adapter, *, operation, event_id):
        """Explicit same-process read capability; no inferred operation owner."""
        need(type(adapter) is a.StorageAdapter and adapter.config==self.config,"adapter")
        a.token(operation);a.token(event_id)
        self._permit(operation)
        lease=self.try_acquire(self.registry.scope,operation,budget_ns=self.config.callback_budget_ns)
        try:
            raw=self.independent_read(self.registry.scope,event_id,max_bytes=a.MAX_BYTES,budget_ns=self.config.callback_budget_ns).raw
            need(a.parse_record(raw)["operation"]==operation,"operation")
            durable=adapter.verify_durable_readback(raw)
            self.borrow_available=self.borrow_alias=True
            projection=adapter.project_current(kind="disposition")
            return {"durable":durable,"projection":projection}
        finally:self._release(lease)
