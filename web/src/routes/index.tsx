import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: BillSplitterApp,
})

interface Home {
  id: string
  name: string
  created_at: number
}

interface Member {
  id: string
  homeId: string
  name: string
}

interface Share {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

interface Bill {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

interface Balance {
  memberId: string
  name: string
  outstandingCents: number
}

function formatCents(cents: number): string {
  const dollars = (cents / 100).toFixed(2)
  return `$${dollars}`
}

function formatDate(isoOrTimestamp: string | number | null): string {
  if (!isoOrTimestamp) return ''
  try {
    const date = new Date(isoOrTimestamp)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(isoOrTimestamp)
  }
}

function BillSplitterApp() {
  const [homes, setHomes] = useState<Home[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])

  const [loadingHomes, setLoadingHomes] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [generalError, setGeneralError] = useState<string | null>(null)

  // Quick form states
  const [newHomeName, setNewHomeName] = useState('')
  const [isCreatingHome, setIsCreatingHome] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [isAddingMember, setIsAddingMember] = useState(false)
  const [billTitle, setBillTitle] = useState('')
  const [billAmountDollars, setBillAmountDollars] = useState('')
  const [isCreatingBill, setIsCreatingBill] = useState(false)
  const [billFormError, setBillFormError] = useState<string | null>(null)

  // Payment states: map shareId -> { paying: boolean, error?: string }
  const [payingMap, setPayingMap] = useState<Record<string, { paying: boolean; error?: string }>>(
    {},
  )

  // Fetch homes list
  const loadHomes = useCallback(async () => {
    setLoadingHomes(true)
    setGeneralError(null)
    try {
      const res = await fetch('/api/homes')
      if (!res.ok) {
        throw new Error(`Failed to load homes (HTTP ${res.status})`)
      }
      const data = (await res.json()) as { homes: Home[] }
      setHomes(data.homes ?? [])
      if (data.homes && data.homes.length > 0) {
        setSelectedHomeId((prev) => {
          const exists = data.homes.some((h) => h.id === prev)
          return exists ? prev : (data.homes[0]?.id ?? '')
        })
      }
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : 'Error fetching homes')
    } finally {
      setLoadingHomes(false)
    }
  }, [])

  // Fetch details for selected home
  const loadHomeData = useCallback(async (homeId: string) => {
    if (!homeId) return
    setLoadingData(true)
    setGeneralError(null)
    try {
      const [membersRes, billsRes, balancesRes] = await Promise.all([
        fetch(`/api/homes/${homeId}/members`),
        fetch(`/api/homes/${homeId}/bills`),
        fetch(`/api/homes/${homeId}/balances`),
      ])

      if (!membersRes.ok || !billsRes.ok || !balancesRes.ok) {
        throw new Error('Failed to load home data from API')
      }

      const membersData = (await membersRes.json()) as { members: Member[] }
      const billsData = (await billsRes.json()) as { bills: Bill[] }
      const balancesData = (await balancesRes.json()) as { balances: Balance[] }

      setMembers(membersData.members ?? [])
      setBills(billsData.bills ?? [])
      setBalances(balancesData.balances ?? [])
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : 'Error loading home data')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    loadHomes()
  }, [loadHomes])

  useEffect(() => {
    if (selectedHomeId) {
      loadHomeData(selectedHomeId)
    } else {
      setMembers([])
      setBills([])
      setBalances([])
    }
  }, [selectedHomeId, loadHomeData])

  // Create Home
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newHomeName.trim()) return
    setIsCreatingHome(true)
    setGeneralError(null)
    try {
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newHomeName.trim() }),
      })
      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error ?? `Failed to create home (${res.status})`)
      }
      const created = (await res.json()) as Home
      setNewHomeName('')
      await loadHomes()
      setSelectedHomeId(created.id)
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : 'Error creating home')
    } finally {
      setIsCreatingHome(false)
    }
  }

  // Add Member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMemberName.trim() || !selectedHomeId) return
    setIsAddingMember(true)
    setGeneralError(null)
    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })
      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error ?? `Failed to add member (${res.status})`)
      }
      setNewMemberName('')
      await loadHomeData(selectedHomeId)
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : 'Error adding member')
    } finally {
      setIsAddingMember(false)
    }
  }

  // Create Bill
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    setBillFormError(null)

    if (!selectedHomeId) {
      setBillFormError('Please select or create a home first.')
      return
    }

    if (members.length === 0) {
      setBillFormError('Cannot split a bill with no members. Add at least one member first.')
      return
    }

    const trimmedTitle = billTitle.trim()
    if (!trimmedTitle) {
      setBillFormError('Bill title is required.')
      return
    }

    const dollarsFloat = Number.parseFloat(billAmountDollars)
    if (Number.isNaN(dollarsFloat) || dollarsFloat <= 0) {
      setBillFormError('Please enter a valid positive dollar amount.')
      return
    }

    const totalCents = Math.round(dollarsFloat * 100)
    if (totalCents <= 0) {
      setBillFormError('Amount must be at least 1 cent.')
      return
    }

    setIsCreatingBill(true)
    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle, totalCents }),
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error ?? `Failed to create bill (${res.status})`)
      }

      setBillTitle('')
      setBillAmountDollars('')
      await loadHomeData(selectedHomeId)
    } catch (err) {
      setBillFormError(err instanceof Error ? err.message : 'Error creating bill')
    } finally {
      setIsCreatingBill(false)
    }
  }

  // Pay Share
  const handlePayShare = async (billId: string, shareId: string) => {
    // Generate unique idempotency key for this payment request
    const idempotencyKey = crypto.randomUUID()
    setPayingMap((prev) => ({ ...prev, [shareId]: { paying: true } }))

    try {
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(errJson?.error ?? `Payment failed (HTTP ${res.status})`)
      }

      const paidShare = (await res.json()) as Share

      // Immediately reflect paid status locally
      setBills((prevBills) =>
        prevBills.map((b) => {
          if (b.id !== billId) return b
          return {
            ...b,
            shares: b.shares.map((s) =>
              s.id === shareId ? { ...s, paidAt: paidShare.paidAt } : s,
            ),
          }
        }),
      )

      // Refresh balances
      if (selectedHomeId) {
        const balancesRes = await fetch(`/api/homes/${selectedHomeId}/balances`)
        if (balancesRes.ok) {
          const balancesData = (await balancesRes.json()) as { balances: Balance[] }
          setBalances(balancesData.balances ?? [])
        }
      }

      setPayingMap((prev) => ({ ...prev, [shareId]: { paying: false } }))
    } catch (err) {
      // Requirement: "keeps the share unpaid and shows an error if the payment fails"
      const errorMsg = err instanceof Error ? err.message : 'Payment error'
      setPayingMap((prev) => ({
        ...prev,
        [shareId]: { paying: false, error: errorMsg },
      }))
    }
  }

  const memberMap = new Map(members.map((m) => [m.id, m.name]))
  const selectedHome = homes.find((h) => h.id === selectedHomeId)

  // Live bill split calculation preview
  const previewDollars = Number.parseFloat(billAmountDollars)
  const previewCents =
    !Number.isNaN(previewDollars) && previewDollars > 0 ? Math.round(previewDollars * 100) : 0
  const previewBase = members.length > 0 ? Math.floor(previewCents / members.length) : 0
  const previewRem = members.length > 0 ? previewCents % members.length : 0

  return (
    <div style={styles.appWrapper}>
      {/* Top Navigation Bar */}
      <header style={styles.navbar}>
        <div style={styles.navContainer}>
          <div style={styles.brandGroup}>
            <div style={styles.logoBadge}>🏠</div>
            <div>
              <h1 style={styles.brandTitle}>SplitHome</h1>
              <p style={styles.brandTagline}>Fair & effortless expense sharing for your home</p>
            </div>
          </div>

          <div style={styles.navControls}>
            <div style={styles.homePickerWrap}>
              <label htmlFor="homeSelect" style={styles.navLabel}>
                Current Home
              </label>
              <select
                id="homeSelect"
                value={selectedHomeId}
                onChange={(e) => setSelectedHomeId(e.target.value)}
                style={styles.selectInput}
                disabled={loadingHomes || homes.length === 0}
              >
                {homes.length === 0 && <option value="">No homes created yet</option>}
                {homes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main style={styles.mainContainer}>
        {/* Global Error Banner */}
        {generalError && (
          <div style={styles.errorAlert}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <div>
                <strong>System Notice: </strong>
                <span>{generalError}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (selectedHomeId) loadHomeData(selectedHomeId)
                else loadHomes()
              }}
              style={styles.retryButton}
            >
              Retry
            </button>
          </div>
        )}

        {/* Quick Action Cards (Create Home & Add Member) */}
        <div style={styles.actionsGrid}>
          {/* Create Home Card */}
          <div style={styles.actionCard}>
            <div style={styles.actionHeader}>
              <span style={styles.actionIcon}>➕</span>
              <h2 style={styles.actionTitle}>Create New Home</h2>
            </div>
            <p style={styles.actionSubtitle}>Start a new household or apartment group.</p>
            <form onSubmit={handleCreateHome} style={styles.actionForm}>
              <input
                type="text"
                placeholder="e.g. Sunnydale Apt 3B"
                value={newHomeName}
                onChange={(e) => setNewHomeName(e.target.value)}
                style={styles.modernInput}
                required
              />
              <button
                type="submit"
                disabled={isCreatingHome || !newHomeName.trim()}
                style={styles.primaryButton}
              >
                {isCreatingHome ? 'Creating...' : 'Create'}
              </button>
            </form>
          </div>

          {/* Add Member Card */}
          <div style={styles.actionCard}>
            <div style={styles.actionHeader}>
              <span style={styles.actionIcon}>👤</span>
              <h2 style={styles.actionTitle}>
                Add Member {selectedHome ? `to "${selectedHome.name}"` : ''}
              </h2>
            </div>
            <p style={styles.actionSubtitle}>
              New members are added to the split queue in registration order.
            </p>
            <form onSubmit={handleAddMember} style={styles.actionForm}>
              <input
                type="text"
                placeholder="e.g. Alex, Sam, Jordan"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                style={styles.modernInput}
                disabled={!selectedHomeId}
                required
              />
              <button
                type="submit"
                disabled={isAddingMember || !newMemberName.trim() || !selectedHomeId}
                style={styles.primaryButton}
              >
                {isAddingMember ? 'Adding...' : 'Add'}
              </button>
            </form>
          </div>
        </div>

        {/* Content Area */}
        {loadingHomes ? (
          <div style={styles.loadingContainer}>
            <div style={styles.pulseSpinner} />
            <p style={{ color: '#64748b', fontSize: 14 }}>Connecting to SplitHome...</p>
          </div>
        ) : homes.length === 0 ? (
          <div style={styles.emptyHeroCard}>
            <div style={styles.emptyHeroIcon}>🏡</div>
            <h3 style={styles.emptyHeroTitle}>No Homes Created Yet</h3>
            <p style={styles.emptyHeroText}>
              Create your first shared home using the form above to add roommates and split your
              expenses effortlessly.
            </p>
          </div>
        ) : (
          <div style={styles.contentLayout}>
            {/* Sidebar Column: Balances & Member Order */}
            <aside style={styles.sidebarColumn}>
              {/* Outstanding Balances */}
              <div style={styles.panelCard}>
                <div style={styles.panelHeaderRow}>
                  <div>
                    <h2 style={styles.panelTitle}>Outstanding Balances</h2>
                    <span style={styles.panelSubtitle}>Unpaid shares per member</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadHomeData(selectedHomeId)}
                    style={styles.ghostIconBtn}
                    title="Refresh balances"
                  >
                    ↻
                  </button>
                </div>

                {loadingData ? (
                  <div style={styles.inlineLoader}>
                    <div style={styles.tinySpinner} />
                    <span>Calculating balances...</span>
                  </div>
                ) : balances.length === 0 ? (
                  <p style={styles.emptyPanelNote}>No members in this home yet.</p>
                ) : (
                  <div style={styles.balanceList}>
                    {balances.map((b) => {
                      const isSettled = b.outstandingCents === 0
                      return (
                        <div key={b.memberId} style={styles.balanceRow}>
                          <div style={styles.memberAvatarCircle}>
                            {b.name.charAt(0).toUpperCase()}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={styles.balanceMemberName}>{b.name}</div>
                            <div style={styles.balanceStatusText}>
                              {isSettled ? (
                                <span style={{ color: '#10b981', fontWeight: 600 }}>
                                  All settled up ✓
                                </span>
                              ) : (
                                <span style={{ color: '#f59e0b' }}>Pending balance</span>
                              )}
                            </div>
                          </div>
                          <div
                            style={{
                              ...styles.balanceAmountText,
                              color: isSettled ? '#10b981' : '#ef4444',
                            }}
                          >
                            {formatCents(b.outstandingCents)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Members Join Order */}
              <div style={styles.panelCard}>
                <div style={styles.panelHeaderRow}>
                  <div>
                    <h2 style={styles.panelTitle}>Split Priority</h2>
                    <span style={styles.panelSubtitle}>Order in which members joined</span>
                  </div>
                </div>
                <p style={styles.priorityExplanation}>
                  When a bill does not divide evenly, remaining extra cents are awarded one-by-one
                  to members in this order.
                </p>
                {members.length === 0 ? (
                  <p style={styles.emptyPanelNote}>No members added yet.</p>
                ) : (
                  <div style={styles.priorityOrderList}>
                    {members.map((m, idx) => (
                      <div key={m.id} style={styles.priorityOrderItem}>
                        <span style={styles.priorityBadge}>#{idx + 1}</span>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{m.name}</span>
                        {idx === 0 && <span style={styles.firstPill}>1st Extra Cent</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>

            {/* Main Content Column: Create Bill & Bills List */}
            <section style={styles.billsColumn}>
              {/* Create Bill Card */}
              <div style={styles.panelCard}>
                <div style={styles.panelHeaderRow}>
                  <div>
                    <h2 style={styles.panelTitle}>Split a Bill</h2>
                    <span style={styles.panelSubtitle}>
                      Automatically divides into exact whole cents
                    </span>
                  </div>
                </div>

                {billFormError && <div style={styles.warningAlert}>⚠️ {billFormError}</div>}

                <form onSubmit={handleCreateBill} style={{ marginTop: 16 }}>
                  <div style={styles.twoColumnInputs}>
                    <div style={{ flex: 2 }}>
                      <label htmlFor="billTitle" style={styles.fieldLabel}>
                        Title / Description
                      </label>
                      <input
                        id="billTitle"
                        type="text"
                        placeholder="e.g. High-Speed Internet, Trader Joe's"
                        value={billTitle}
                        onChange={(e) => setBillTitle(e.target.value)}
                        style={styles.modernInput}
                        required
                      />
                    </div>

                    <div style={{ flex: 1 }}>
                      <label htmlFor="billAmount" style={styles.fieldLabel}>
                        Total Amount ($)
                      </label>
                      <input
                        id="billAmount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        value={billAmountDollars}
                        onChange={(e) => setBillAmountDollars(e.target.value)}
                        style={styles.modernInput}
                        required
                      />
                    </div>
                  </div>

                  {/* Real-Time Split Preview */}
                  {members.length > 0 && previewCents > 0 && (
                    <div style={styles.previewBox}>
                      <div style={styles.previewHeading}>
                        <span>Split Calculation</span>
                        <span style={styles.previewTotalPill}>
                          {formatCents(previewCents)} ÷ {members.length} member
                          {members.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div style={styles.previewMembersGrid}>
                        {members.map((m, i) => {
                          const amt = previewBase + (i < previewRem ? 1 : 0)
                          const hasBonus = i < previewRem
                          return (
                            <div key={m.id} style={styles.previewMemberCard}>
                              <span style={{ color: '#475569' }}>{m.name}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <strong style={{ color: '#0f172a' }}>{formatCents(amt)}</strong>
                                {hasBonus && (
                                  <span
                                    style={styles.remainderTag}
                                    title="Received +1 cent remainder"
                                  >
                                    +1¢
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                    <button
                      type="submit"
                      disabled={isCreatingBill || members.length === 0}
                      style={{
                        ...styles.primaryButton,
                        opacity: members.length === 0 ? 0.5 : 1,
                      }}
                    >
                      {isCreatingBill ? 'Splitting...' : 'Split Bill'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Bills List Header */}
              <div style={styles.billsListSection}>
                <div style={styles.billsSectionHeader}>
                  <h2 style={styles.panelTitle}>Active Bills ({bills.length})</h2>
                  <span style={styles.panelSubtitle}>
                    All shares are tracked with idempotent payments
                  </span>
                </div>

                {loadingData ? (
                  <div style={styles.loadingContainer}>
                    <div style={styles.pulseSpinner} />
                    <p style={{ color: '#64748b', fontSize: 14 }}>Loading bills...</p>
                  </div>
                ) : bills.length === 0 ? (
                  <div style={styles.emptyCardMini}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🧾</div>
                    <h3 style={{ margin: 0, fontSize: 16, color: '#334155' }}>
                      No Bills Split Yet
                    </h3>
                    <p style={{ color: '#64748b', fontSize: 13, margin: '6px 0 0' }}>
                      {members.length === 0
                        ? 'Add at least one member to this home to start splitting bills.'
                        : 'Use the form above to add your first bill.'}
                    </p>
                  </div>
                ) : (
                  <div style={styles.billsCardsGrid}>
                    {bills.map((bill) => {
                      const paidShares = bill.shares.filter((s) => s.paidAt !== null)
                      const isComplete = paidShares.length === bill.shares.length

                      return (
                        <div key={bill.id} style={styles.billItemCard}>
                          <div style={styles.billItemHeader}>
                            <div>
                              <h3 style={styles.billItemTitle}>{bill.title}</h3>
                              <span style={styles.billItemCode}>Ref: {bill.id.slice(0, 8)}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={styles.billItemTotal}>{formatCents(bill.totalCents)}</div>
                              <span
                                style={{
                                  ...styles.statusTag,
                                  backgroundColor: isComplete ? '#dcfce7' : '#fef3c7',
                                  color: isComplete ? '#15803d' : '#b45309',
                                }}
                              >
                                {paidShares.length}/{bill.shares.length} Shares Paid
                              </span>
                            </div>
                          </div>

                          {/* Individual Shares */}
                          <div style={styles.sharesList}>
                            {bill.shares.map((share) => {
                              const memberName =
                                memberMap.get(share.memberId) ??
                                `Member (${share.memberId.slice(0, 6)})`
                              const isPaid = share.paidAt !== null
                              const payState = payingMap[share.id]

                              return (
                                <div
                                  key={share.id}
                                  style={{
                                    ...styles.shareRowCard,
                                    backgroundColor: isPaid ? '#f8fafc' : '#ffffff',
                                    borderColor: isPaid ? '#f1f5f9' : '#e2e8f0',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div
                                      style={{
                                        ...styles.memberSmallAvatar,
                                        backgroundColor: isPaid ? '#e2e8f0' : '#e0e7ff',
                                        color: isPaid ? '#64748b' : '#4338ca',
                                      }}
                                    >
                                      {memberName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                      <div style={styles.shareMemberName}>{memberName}</div>
                                      <div style={styles.shareSubtext}>
                                        {isPaid
                                          ? `Paid • ${formatDate(share.paidAt)}`
                                          : 'Unpaid share'}
                                      </div>
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                    <span style={styles.sharePrice}>
                                      {formatCents(share.amountCents)}
                                    </span>

                                    {isPaid ? (
                                      <span style={styles.paidCheckBadge}>✓ Paid</span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handlePayShare(bill.id, share.id)}
                                        disabled={payState?.paying}
                                        style={styles.payNowBtn}
                                      >
                                        {payState?.paying ? 'Paying...' : 'Pay Share'}
                                      </button>
                                    )}
                                  </div>

                                  {/* Error Alert if Payment Failed */}
                                  {payState?.error && (
                                    <div style={styles.sharePaymentError}>⚠️ {payState.error}</div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  appWrapper: {
    minHeight: '100vh',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    WebkitFontSmoothing: 'antialiased',
  },
  navbar: {
    backgroundColor: '#ffffff',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky',
    top: 0,
    zIndex: 30,
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
  },
  navContainer: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
  },
  brandGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  logoBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.25)',
  },
  brandTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: '-0.025em',
    color: '#0f172a',
  },
  brandTagline: {
    margin: '2px 0 0',
    fontSize: 13,
    color: '#64748b',
    fontWeight: 500,
  },
  navControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  homePickerWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  navLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#64748b',
  },
  selectInput: {
    padding: '8px 14px',
    borderRadius: 10,
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: 14,
    fontWeight: 600,
    outline: 'none',
    cursor: 'pointer',
    minWidth: 190,
  },
  mainContainer: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '28px 20px 80px',
  },
  errorAlert: {
    backgroundColor: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fee2e2',
    borderRadius: 12,
    padding: '12px 18px',
    marginBottom: 24,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 14,
  },
  retryButton: {
    backgroundColor: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  actionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 18,
    marginBottom: 24,
  },
  actionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: '20px 22px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
  },
  actionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  actionIcon: {
    fontSize: 16,
  },
  actionTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
  },
  actionSubtitle: {
    margin: '4px 0 14px',
    fontSize: 13,
    color: '#64748b',
  },
  actionForm: {
    display: 'flex',
    gap: 10,
  },
  modernInput: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#ffffff',
    outline: 'none',
    boxSizing: 'border-box',
    width: '100%',
  },
  primaryButton: {
    background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 10,
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)',
  },
  contentLayout: {
    display: 'grid',
    gridTemplateColumns: '320px 1fr',
    gap: 24,
    alignItems: 'start',
  },
  sidebarColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  billsColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  panelCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: '22px 24px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)',
  },
  panelHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  panelTitle: {
    margin: 0,
    fontSize: 17,
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.01em',
  },
  panelSubtitle: {
    display: 'block',
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  ghostIconBtn: {
    background: 'none',
    border: 'none',
    color: '#6366f1',
    fontSize: 18,
    cursor: 'pointer',
    padding: 4,
  },
  balanceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginTop: 14,
  },
  balanceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    border: '1px solid #f1f5f9',
  },
  memberAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    backgroundColor: '#e0e7ff',
    color: '#4338ca',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
  },
  memberSmallAvatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
  },
  balanceMemberName: {
    fontWeight: 600,
    fontSize: 14,
    color: '#0f172a',
  },
  balanceStatusText: {
    fontSize: 12,
    marginTop: 2,
  },
  balanceAmountText: {
    fontWeight: 700,
    fontSize: 15,
  },
  priorityExplanation: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 1.5,
    margin: '6px 0 12px',
  },
  priorityOrderList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  priorityOrderItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    border: '1px solid #f1f5f9',
    fontSize: 13,
  },
  priorityBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    backgroundColor: '#e2e8f0',
    padding: '2px 6px',
    borderRadius: 6,
  },
  firstPill: {
    marginLeft: 'auto',
    fontSize: 10,
    fontWeight: 700,
    color: '#4f46e5',
    backgroundColor: '#eef2ff',
    padding: '2px 8px',
    borderRadius: 12,
  },
  twoColumnInputs: {
    display: 'flex',
    gap: 14,
  },
  fieldLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 700,
    color: '#334155',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  warningAlert: {
    backgroundColor: '#fffbeb',
    color: '#b45309',
    border: '1px solid #fef3c7',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 13,
    marginTop: 12,
  },
  previewBox: {
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: 12,
    padding: '14px 16px',
    marginTop: 16,
  },
  previewHeading: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontWeight: 700,
    fontSize: 13,
    color: '#166534',
    marginBottom: 10,
  },
  previewTotalPill: {
    fontSize: 12,
    fontWeight: 600,
    backgroundColor: '#dcfce7',
    padding: '2px 8px',
    borderRadius: 12,
  },
  previewMembersGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 8,
  },
  previewMemberCard: {
    backgroundColor: '#ffffff',
    border: '1px solid #dcfce7',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 12,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  remainderTag: {
    fontSize: 10,
    fontWeight: 700,
    color: '#16a34a',
    backgroundColor: '#dcfce7',
    padding: '1px 5px',
    borderRadius: 4,
  },
  billsListSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  billsSectionHeader: {
    display: 'flex',
    flexDirection: 'column',
  },
  billsCardsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  billItemCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: '20px 22px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
  },
  billItemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 16,
    borderBottom: '1px solid #f1f5f9',
    marginBottom: 14,
  },
  billItemTitle: {
    margin: 0,
    fontSize: 17,
    fontWeight: 700,
    color: '#0f172a',
  },
  billItemCode: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  billItemTotal: {
    fontSize: 20,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.02em',
  },
  statusTag: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 10,
    marginTop: 4,
  },
  sharesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  shareRowCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    gap: 10,
  },
  shareMemberName: {
    fontWeight: 600,
    fontSize: 14,
    color: '#0f172a',
  },
  shareSubtext: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  sharePrice: {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
  },
  paidCheckBadge: {
    backgroundColor: '#dcfce7',
    color: '#15803d',
    padding: '5px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
  },
  payNowBtn: {
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: '#ffffff',
    border: 'none',
    padding: '7px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)',
  },
  sharePaymentError: {
    width: '100%',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
  },
  emptyHeroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: '60px 24px',
    textAlign: 'center',
    border: '1px dashed #cbd5e1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  emptyHeroIcon: {
    fontSize: 48,
    marginBottom: 14,
  },
  emptyHeroTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    color: '#0f172a',
  },
  emptyHeroText: {
    margin: '8px 0 0',
    fontSize: 14,
    color: '#64748b',
    maxWidth: 420,
    lineHeight: 1.5,
  },
  emptyCardMini: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: '36px 20px',
    textAlign: 'center',
    border: '1px dashed #cbd5e1',
  },
  emptyPanelNote: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
    margin: '12px 0',
  },
  loadingContainer: {
    textAlign: 'center',
    padding: '48px 20px',
  },
  inlineLoader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    color: '#64748b',
    fontSize: 13,
  },
  pulseSpinner: {
    width: 32,
    height: 32,
    border: '3px solid #e2e8f0',
    borderTopColor: '#4f46e5',
    borderRadius: '50%',
    margin: '0 auto 12px',
    animation: 'spin 0.8s linear infinite',
  },
  tinySpinner: {
    width: 14,
    height: 14,
    border: '2px solid #e2e8f0',
    borderTopColor: '#4f46e5',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
}
