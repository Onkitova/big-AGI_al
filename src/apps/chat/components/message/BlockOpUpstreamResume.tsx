import * as React from 'react';
import TimeAgo from 'react-timeago';

import { Box, Button, ButtonGroup, Tooltip, Typography } from '@mui/joy';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';

import type { AixReattachMode } from '~/modules/aix/client/aix.client';

import type { DMessageGenerator } from '~/common/stores/chat/chat.message';


const ARM_TIMEOUT_MS = 4000;


/**
 * Resume controls for an upstream-stored run.
 *  - Resume:  SSE replay (live deltas) - canonical path. Always offered when onResume exists.
 *  - Recover: one-shot JSON GET - shown only for vendors that benefit from it (see _NS_RECOVER_UHTS).
 *  - Cancel/Stop: terminate the upstream run (delete the resource).
 *
 * Single callback `onResume(streaming: boolean)` covers both Resume (true) and Recover (false).
 */
export function BlockOpUpstreamResume(props: {
  upstreamHandle: Exclude<DMessageGenerator['upstreamHandle'], undefined>,
  pending?: boolean; // true while the message is actively streaming; labels the Delete button as "Stop"
  onResume?: (mode: AixReattachMode) => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {

  // state - separate flags so each button shows its own loading spinner
  const [isReplaying, setIsReplaying] = React.useState(false);
  const [isSnapshotting, setIsSnapshotting] = React.useState(false);
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteArmed, setDeleteArmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // expiration: boolean is evaluated at render (may lag briefly if nothing re-renders past expiry).
  // TimeAgo handles its own tick for the label; the button's disabled state is the only consumer of this flag.
  const { expiresAt /*, runId = ''*/ } = props.upstreamHandle;
  // const isExpired = expiresAt != null && Date.now() > expiresAt;

  // self-gate: show "Recover" only for Gemini Interactions (SSE can hang while the JSON resource stays fetchable).
  // Other vendors recover via SSE replay alone. See kb/modules/LLM-gemini-interactions.md.
  const showRecover = !!props.onResume && props.upstreamHandle.uht === 'vnd.gem.interactions';

  // handlers

  const handleResume = React.useCallback(async (mode: AixReattachMode) => {
    if (!props.onResume) return;
    const setBusy = mode === 'replay' ? setIsReplaying : setIsSnapshotting;
    setError(null);
    setBusy(true);
    try {
      await props.onResume(mode);
    } catch (err: any) {
      setError(err?.message || (mode === 'replay' ? 'Resume failed' : 'Recover failed'));
    } finally {
      setBusy(false);
    }
  }, [props]);

  const handleCancel = React.useCallback(async () => {
    if (!props.onCancel) return;
    setError(null);
    setIsCancelling(true);
    try {
      await props.onCancel();
    } catch (err: any) {
      setError(err?.message || 'Cancel failed');
    } finally {
      setIsCancelling(false);
    }
  }, [props]);

  // Two-click arm: first click arms (visible red "Confirm?"), second click (within ARM_TIMEOUT_MS) executes.
  const handleDelete = React.useCallback(async () => {
    if (!props.onDelete) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    setDeleteArmed(false);
    setError(null);
    setIsDeleting(true);
    try {
      await props.onDelete();
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteArmed, props]);

  // Auto-disarm after ARM_TIMEOUT_MS so the armed state can't leak into a later session
  React.useEffect(() => {
    if (!deleteArmed) return;
    const t = setTimeout(() => setDeleteArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [deleteArmed]);

  // Disabled-state policy:
  //  - Resume / Recover: disabled while ANY operation is in flight (mutually exclusive with each
  //    other AND with the short ops, to avoid double-firing).
  //  - Cancel: disabled only by the SHORT ops it would race with (not by Resume - cancelling a
  //    long-running stream from local is meaningful even if the stream isn't blocking).
  //  - Stop/Delete: only the short ops gate it. NOT gated by Resume - this is the user's escape
  //    hatch for hung Resume/Recover; locking it would defeat the entire "stuck stream" UX.
  const inFlightAny = isReplaying || isSnapshotting || isCancelling || isDeleting;
  const inFlightShort = isCancelling || isDeleting;


  return (
    <Box
      sx={{
        mt: 1,
        mx: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      <ButtonGroup>
        {props.onResume && (
          <Tooltip title='Resume by re-streaming from the upstream run'>
            <Button
              disabled={inFlightAny}
              loading={isReplaying}
              startDecorator={<PlayArrowRoundedIcon color='success' />}
              onClick={() => handleResume('replay')}
            >
              Resume
            </Button>
          </Tooltip>
        )}

        {showRecover && (
          <Tooltip title='Fetch the result without streaming - recovers stuck or hung runs'>
            <Button
              disabled={inFlightAny}
              loading={isSnapshotting}
              startDecorator={<DownloadIcon />}
              onClick={() => handleResume('snapshot')}
            >
              Recover
            </Button>
          </Tooltip>
        )}

        {props.onCancel && (
          <Tooltip title='Cancel the response generation'>
            <Button
              disabled={inFlightShort}
              loading={isCancelling}
              // startDecorator={<CancelIcon />}
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </Tooltip>
        )}

        {props.onDelete && (
          <Tooltip title={deleteArmed ? 'Click again to confirm - cancels the run upstream (no resume after)' : (props.pending ? 'Stop this response and cancel the upstream run' : 'Cancel the upstream run')}>
            <Button
              loading={isDeleting}
              color={deleteArmed ? 'danger' : 'neutral'}
              variant={deleteArmed ? 'solid' : 'outlined'}
              startDecorator={<StopRoundedIcon />}
              onClick={handleDelete}
              disabled={inFlightShort}
            >
              {deleteArmed ? 'Confirm?' : (props.pending ? 'Stop' : 'Cancel')}
            </Button>
          </Tooltip>
        )}
      </ButtonGroup>

      {error && (
        <Typography level='body-xs' color='danger' sx={{ fontSize: '0.75rem' }}>
          {error}
        </Typography>
      )}

      {!props.pending && !!expiresAt && <Typography level='body-xs' sx={{ fontSize: '0.65rem', opacity: 0.6 }}>
        {/*Run ID: {runId.slice(0, 12)}...*/}
        {/*{!!expiresAt && <> · Expires <TimeAgo date={expiresAt} /></>}*/}
        Expires <TimeAgo date={expiresAt} />
      </Typography>}
    </Box>
  );
}
