import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useOrg } from '../context/useOrg';
import { Users, UserPlus, Trash2, Crown, Loader2 } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Card from './ui/Card';

export default function MemberManager() {
    const { currentOrg } = useOrg();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [members, setMembers] = useState([]);
    const [currentUserId, setCurrentUserId] = useState(null);

    const isOwner = currentUserId === currentOrg?.owner_uid;

    // Fetch members and current user
    useEffect(() => {
        const fetchData = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) setCurrentUserId(user.id);

            if (!currentOrg?.id) return;

            const { data, error } = await supabase
                .from('org_members')
                .select('user_id, role')
                .eq('org_id', currentOrg.id);

            if (!error && data) {
                setMembers(data.map((m) => ({
                    userId: m.user_id,
                    role: m.role,
                    isOwner: m.role === 'owner',
                    isSelf: m.user_id === user?.id,
                })));
            }
        };

        fetchData();
    }, [currentOrg?.id, currentOrg?.owner_uid]);

    const handleAddMember = async (e) => {
        e.preventDefault();
        if (!email.trim()) return;
        if (!isOwner) {
            setError('Only the organization owner can add members');
            return;
        }

        setLoading(true);
        setError('');
        setSuccess('');

        try {
            const { data, error: rpcErr } = await supabase.functions.invoke('resolve-member-email', {
                body: { orgId: currentOrg.id, email: email.trim() },
            });

            if (rpcErr) throw rpcErr;

            const { status, displayName } = data || {};

            if (status === 'already_member') {
                setError('This user is already a member');
            } else if (status === 'added') {
                // Re-fetch members
                const { data: memberData } = await supabase
                    .from('org_members')
                    .select('user_id, role')
                    .eq('org_id', currentOrg.id);

                if (memberData) {
                    const { data: { user } } = await supabase.auth.getUser();
                    setMembers(memberData.map((m) => ({
                        userId: m.user_id,
                        role: m.role,
                        isOwner: m.role === 'owner',
                        isSelf: m.user_id === user?.id,
                    })));
                }
                setSuccess(`${displayName || email} has been added!`);
                setEmail('');
            } else if (status === 'pending') {
                setSuccess(`Invitation sent to ${email}. They'll be added when they sign in.`);
                setEmail('');
            }

            setTimeout(() => setSuccess(''), 5000);
        } catch (err) {
            setError(err.message || 'Failed to add member');
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveMember = async (userId) => {
        if (!isOwner) return;

        // Find the member to check role
        const member = members.find((m) => m.userId === userId);
        if (member?.isOwner) {
            setError("Can't remove the organization owner");
            return;
        }

        try {
            const { error: deleteErr } = await supabase
                .from('org_members')
                .delete()
                .eq('org_id', currentOrg.id)
                .eq('user_id', userId);

            if (deleteErr) throw deleteErr;

            setMembers((prev) => prev.filter((m) => m.userId !== userId));
            setSuccess('Member removed');
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to remove member');
        }
    };

    return (
        <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold text-slate-900">Members</h3>
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full ml-2">
                    {members.length}
                </span>
            </div>

            {/* Member List */}
            <div className="space-y-2 mb-6">
                {members.map(({ userId, isOwner: memberIsOwner, isSelf }) => (
                    <div
                        key={userId}
                        className="flex items-center justify-between p-3 bg-slate-50 rounded-lg"
                    >
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                                <span className="text-xs font-bold text-primary">
                                    {userId.slice(0, 2).toUpperCase()}
                                </span>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-slate-700">
                                    {userId.slice(0, 12)}...
                                    {isSelf && <span className="text-xs text-slate-400 ml-1">(you)</span>}
                                </p>
                            </div>
                            {memberIsOwner && (
                                <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                    <Crown className="w-3 h-3" /> Owner
                                </span>
                            )}
                        </div>
                        {isOwner && !memberIsOwner && (
                            <button
                                onClick={() => handleRemoveMember(userId)}
                                className="text-slate-400 hover:text-danger transition-colors p-1"
                                title="Remove member"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Add Member Form (Owner only) */}
            {isOwner && (
                <form onSubmit={handleAddMember} className="flex gap-2">
                    <Input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter member's Google email"
                        type="email"
                        className="flex-1"
                    />
                    <Button type="submit" loading={loading} size="md">
                        <UserPlus className="w-4 h-4" />
                        Add
                    </Button>
                </form>
            )}

            {error && (
                <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{error}</p>
            )}
            {success && (
                <p className="text-sm text-success bg-green-50 border border-green-200 rounded-lg px-3 py-2 mt-3">{success}</p>
            )}

            {!isOwner && (
                <p className="text-xs text-slate-400 mt-4">
                    Only the organization owner can manage members.
                </p>
            )}
        </Card>
    );
}
