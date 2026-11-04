import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { errorMessage } from '../api/errors';
import { addComment, listComments } from '../api/tickets';
import type { Comment, Ticket } from '../api/types';
import { canWriteInternal } from '../auth/access';
import { useMe } from '../auth/RequireAuth';
import { Button } from '../ui/Button';
import { Card, Eyebrow } from '../ui/Card';
import { Loading } from '../ui/Empty';
import { Field, invalidProps } from '../ui/Field';
import { formatWhen } from '../ui/format';
import { roleLabel } from '../ui/role';
import { can } from '../ui/status';
import { Switch } from '../ui/Switch';
import { useToast } from '../ui/Toast';

// ความเห็นในใบ ใช้ร่วมกันทั้งหน้านักศึกษา ช่าง และ Staff — ช่องเขียนโผล่เมื่อ actions มี comment เท่านั้น (UI-PLAN 2 ข้อ 1)
// นักศึกษาไม่ได้รับความเห็นภายในจาก API อยู่แล้ว หน้านี้จึงไม่ต้องกรองเอง
const MAX = 2000;

const authorOf = (c: Comment, meId: string | undefined): string => {
  if (c.author.id === meId) return 'คุณ';
  // ชื่อว่างได้ (บัญชีที่ admin เพิ่มล่วงหน้า) — บอกบทบาทแทน ผู้พักจะได้รู้ว่าคนตอบเป็นช่างหรือ Staff
  return c.author.name ?? roleLabel(c.author.role);
};

export function CommentsCard({ ticket }: { ticket: Ticket }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = ['comments', ticket.id];
  const comments = useQuery({ queryKey: key, queryFn: () => listComments(ticket.id) });

  const send = useMutation({
    mutationFn: () => addComment(ticket.id, body.trim(), internal),
    onSuccess: () => {
      setBody('');
      setInternal(false);
      toast('ส่งความเห็นแล้ว');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors().body) {
        setError('พิมพ์ความเห็นก่อนส่ง');
        return;
      }
      toast(errorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const submit = () => {
    if (!body.trim()) {
      setError('พิมพ์ความเห็นก่อนส่ง');
      document.getElementById('comment-body')?.focus();
      return;
    }
    send.mutate();
  };

  return (
    <Card label="ความเห็น">
      <Eyebrow>ความเห็น</Eyebrow>
      {comments.isPending ? (
        <Loading rows={1} />
      ) : comments.isError ? (
        <p className="small muted">{errorMessage(comments.error)}</p>
      ) : comments.data.length === 0 ? (
        <p className="small muted">ยังไม่มีความเห็น</p>
      ) : (
        <ol className="comments">
          {comments.data.map((c) => (
            <li key={c.id} className={c.is_internal ? 'internal' : undefined}>
              <p className="small">
                <b>{authorOf(c, me?.id)}</b>
                {c.author.name && c.author.id !== me?.id && (
                  <span className="muted"> · {roleLabel(c.author.role)}</span>
                )}
                <span className="muted num"> · {formatWhen(c.created_at)}</span>
                {c.is_internal && <span className="tag">ภายใน</span>}
              </p>
              <p className="comment-body">{c.body}</p>
            </li>
          ))}
        </ol>
      )}

      {can(ticket, 'comment') && (
        <>
          <Field id="comment-body" label="เขียนความเห็น" error={error}>
            <textarea
              className={`input${error ? ' err' : ''}`}
              id="comment-body"
              rows={3}
              maxLength={MAX}
              placeholder="เช่น สะดวกให้เข้าห้องช่วงบ่าย"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setError(null);
              }}
              {...invalidProps('comment-body', error)}
            />
          </Field>
          {canWriteInternal(me?.role) && (
            <Switch
              checked={internal}
              onChange={setInternal}
              title="ความเห็นภายใน"
              sub="เห็นเฉพาะช่างและ Staff นักศึกษาไม่เห็น"
            />
          )}
          <Button variant="primary" onClick={submit} busy={send.isPending}>
            {internal ? 'ส่งความเห็นภายใน' : 'ส่งความเห็น'}
          </Button>
        </>
      )}
    </Card>
  );
}
