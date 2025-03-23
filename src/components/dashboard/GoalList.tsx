import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, PlusCircle } from "lucide-react";
import { Goal, GoalCategory } from "@/types/finance";
import GoalCard from "@/components/dashboard/GoalCard";
import GlassCard from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/services/api";
import { addGoal, updateGoal, getUserProfile } from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MICRO_GOAL_THRESHOLD } from "@/components/dashboard/goalUtils";

interface GoalListProps {
  loading: boolean;
  goals: Goal[];
  goalSizeTab: "micro" | "macro";
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onEmergencyFundUsed?: (amount: number) => void;
  onGoalsUpdate?: (updatedGoals: Goal[]) => void;
}

const GoalList: React.FC<GoalListProps> = ({
  loading,
  goals,
  goalSizeTab,
  onDelete,
  onEdit,
  onEmergencyFundUsed,
  onGoalsUpdate,
}) => {
  const { toast } = useToast();
  const [filteredGoals, setFilteredGoals] = useState<Goal[]>([]);
  const [sourceGoal, setSourceGoal] = useState<Goal | null>(null);
  const [targetGoalId, setTargetGoalId] = useState<string>("");
  const [showRebalanceDialog, setShowRebalanceDialog] = useState(false);
  const [rebalanceAmount, setRebalanceAmount] = useState<string>("");
  const [maxRebalanceAmount, setMaxRebalanceAmount] = useState<number>(0);

  useEffect(() => {
    // Filter out any goals that are loans (have "Loan for" in the title)
    const nonLoanGoals = goals.filter(
      (goal) => !goal.title.startsWith("Loan for")
    );
    setFilteredGoals(nonLoanGoals);
  }, [goals]);

  const handleFinanceGoal = async (
    goalId: string,
    goalTitle: string,
    remainingAmount: number
  ) => {
    try {
      // Get the original goal to reference its data
      const originalGoal = goals.find((goal) => goal.id === goalId);

      if (!originalGoal) {
        toast({
          title: "Error",
          description: "Goal not found",
          variant: "destructive",
        });
        return;
      }

      // Get user profile to check and update initial savings
      const userProfile = await getUserProfile();
      if (!userProfile) {
        toast({
          title: "Error",
          description: "User profile not found",
          variant: "destructive",
        });
        return;
      }

      // Check if there's enough in initial savings for the loan
      if (remainingAmount > userProfile.savings) {
        toast({
          title: "Insufficient Funds",
          description:
            "You don't have enough in your initial savings to cover this loan.",
          variant: "destructive",
        });
        return;
      }

      // Create a new loan goal based on the original goal
      const loanGoal: Omit<Goal, "id" | "progress"> = {
        title: `Loan for ${goalTitle}`,
        targetAmount: remainingAmount,
        currentAmount: 0,
        timeline: 2, // Default timeline of 2 years for loans
        category: "Other" as any,
        monthlyContribution: Math.abs(remainingAmount / 24), // Ensure positive monthly payment
        riskLevel: "conservative",
        description: `Loan taken to finance ${goalTitle}`,
      };

      // Add the loan goal to the database
      await addGoal(loanGoal);

      // Update user's initial savings to account for the loan
      const updatedProfile = {
        ...userProfile,
        savings: userProfile.savings - remainingAmount,
        monthlyInvestmentCapacity:
          userProfile.monthlyInvestmentCapacity -
          Math.abs(remainingAmount / 24),
      };
      localStorage.setItem(
        "growvest_user_profile",
        JSON.stringify(updatedProfile)
      );

      // Mark the original goal as completed (set currentAmount to targetAmount)
      await updateGoal({
        id: goalId,
        currentAmount: originalGoal.targetAmount,
        progress: 100,
      });

      // Show success message
      toast({
        title: "Financing Applied",
        description: `Your goal "${goalTitle}" has been financed and a new loan goal has been created.`,
      });

      // Refresh the page to show the updated goals
      window.location.reload();
    } catch (error) {
      console.error("Error financing goal:", error);
      toast({
        title: "Error",
        description: "Failed to finance goal. Please try again.",
        variant: "destructive",
      });
    }
  };

  const initiateRebalance = (
    goalId: string,
    goalTitle: string,
    currentAmountValue: number
  ) => {
    const goal = filteredGoals.find((g) => g.id === goalId);
    if (!goal) return;

    setSourceGoal(goal);
    setMaxRebalanceAmount(currentAmountValue);
    setRebalanceAmount(currentAmountValue.toString());
    setShowRebalanceDialog(true);
  };

  const handleRebalanceConfirm = async () => {
    try {
      if (!sourceGoal || !targetGoalId) {
        toast({
          title: "Error",
          description: "Please select a goal to transfer funds to",
          variant: "destructive",
        });
        return;
      }

      const amount = parseFloat(rebalanceAmount);
      if (isNaN(amount) || amount <= 0 || amount > maxRebalanceAmount) {
        toast({
          title: "Error",
          description: `Please enter a valid amount between 1 and ${maxRebalanceAmount}`,
          variant: "destructive",
        });
        return;
      }

      const targetGoal = filteredGoals.find((g) => g.id === targetGoalId);
      if (!targetGoal) {
        toast({
          title: "Error",
          description: "Target goal not found",
          variant: "destructive",
        });
        return;
      }

      // Calculate new amounts ensuring they don't exceed target amounts
      const newSourceAmount = Math.max(0, sourceGoal.currentAmount - amount);
      const newTargetAmount = Math.min(
        targetGoal.currentAmount + amount,
        targetGoal.targetAmount
      );

      // Calculate new progress values
      const newSourceProgress = Math.min(
        100,
        Math.round((newSourceAmount / sourceGoal.targetAmount) * 100)
      );
      const newTargetProgress = Math.min(
        100,
        Math.round((newTargetAmount / targetGoal.targetAmount) * 100)
      );

      // Update source goal - reduce current amount
      const updatedSourceGoal = await updateGoal({
        id: sourceGoal.id,
        currentAmount: newSourceAmount,
        progress: newSourceProgress,
      });

      // Update target goal - increase current amount
      const updatedTargetGoal = await updateGoal({
        id: targetGoalId,
        currentAmount: newTargetAmount,
        progress: newTargetProgress,
      });

      // Update the goals state
      if (onGoalsUpdate) {
        const updatedGoals = goals.map((goal) => {
          if (goal.id === sourceGoal.id) return updatedSourceGoal;
          if (goal.id === targetGoalId) return updatedTargetGoal;
          return goal;
        });
        onGoalsUpdate(updatedGoals);
      }

      // Show success message
      toast({
        title: "Rebalance Successful",
        description: `₹${amount.toFixed(2)} moved from "${
          sourceGoal.title
        }" to "${targetGoal.title}"`,
      });

      // Reset states
      setShowRebalanceDialog(false);
      setSourceGoal(null);
      setTargetGoalId("");
      setRebalanceAmount("");
    } catch (error) {
      console.error("Error rebalancing goals:", error);
      toast({
        title: "Error",
        description: "Failed to rebalance goals. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUseEmergencyFund = async (
    goalId: string,
    goalTitle: string,
    amount: number
  ) => {
    try {
      // Get the original goal to reference its data
      const originalGoal = goals.find((goal) => goal.id === goalId);

      if (!originalGoal) {
        toast({
          title: "Error",
          description: "Goal not found",
          variant: "destructive",
        });
        return;
      }

      // Get user profile to check initial savings
      const userProfile = await getUserProfile();
      if (!userProfile) {
        toast({
          title: "Error",
          description: "User profile not found",
          variant: "destructive",
        });
        return;
      }

      // Calculate remaining initial savings
      const totalCurrentAmount = goals.reduce(
        (sum, goal) => sum + goal.currentAmount,
        0
      );
      const remainingSavings = userProfile.savings - totalCurrentAmount;

      // Calculate remaining amount needed for the goal
      const remainingGoalAmount =
        originalGoal.targetAmount - originalGoal.currentAmount;

      // Check if emergency fund amount exceeds remaining initial savings
      if (amount > remainingSavings) {
        toast({
          title: "Insufficient Emergency Fund",
          description: `Your emergency fund amount cannot exceed your remaining initial savings of ₹${remainingSavings.toFixed(
            2
          )}.`,
          variant: "destructive",
        });
        return;
      }

      // Check if emergency fund amount exceeds remaining goal amount
      if (amount > remainingGoalAmount) {
        toast({
          title: "Invalid Emergency Fund Amount",
          description: `Your emergency fund amount cannot exceed the remaining goal amount of ₹${remainingGoalAmount.toFixed(
            2
          )}.`,
          variant: "destructive",
        });
        return;
      }

      // Calculate new current amount and ensure it doesn't exceed target amount
      const newCurrentAmount = Math.min(
        originalGoal.currentAmount + amount,
        originalGoal.targetAmount
      );
      const newProgress = Math.min(
        100,
        Math.round((newCurrentAmount / originalGoal.targetAmount) * 100)
      );

      // Update the goal with the emergency fund contribution
      const updatedGoal = await updateGoal({
        id: goalId,
        currentAmount: newCurrentAmount,
        progress: newProgress,
      });

      // Update the goals state
      if (onGoalsUpdate) {
        const updatedGoals = goals.map((goal) =>
          goal.id === goalId ? updatedGoal : goal
        );
        onGoalsUpdate(updatedGoals);
      }

      // Update emergency fund in parent component
      if (onEmergencyFundUsed) {
        onEmergencyFundUsed(amount);
      }

      // Show success message
      toast({
        title: "Emergency Fund Used",
        description: `₹${amount.toFixed(
          2
        )} from your emergency fund has been added to "${goalTitle}".`,
      });

      // Close the emergency fund dialog
      setShowRebalanceDialog(false);
      setRebalanceAmount("");
    } catch (error) {
      console.error("Error using emergency fund:", error);
      toast({
        title: "Error",
        description: "Failed to use emergency fund. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (filteredGoals.length === 0) {
    return (
      <GlassCard className="text-center py-12">
        <p className="text-muted-foreground">
          {goalSizeTab === "micro"
            ? "No micro goals found in this category."
            : "No macro goals found in this category."}
        </p>
        <Link to="/goals/new">
          <Button className="mt-4 gap-2">
            <PlusCircle className="h-4 w-4" />
            Create your first {/* {goalSizeTab} */} goal
          </Button>
        </Link>
      </GlassCard>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredGoals.map((goal) => (
          <GoalCard
            key={goal.id}
            id={goal.id}
            title={goal.title}
            targetAmount={formatCurrency(goal.targetAmount)}
            currentAmount={formatCurrency(goal.currentAmount)}
            timeline={`${goal.timeline} years`}
            progress={goal.progress}
            category={goal.category}
            onDelete={onDelete}
            onEdit={onEdit}
            onFinance={handleFinanceGoal}
            onRebalance={
              goalSizeTab === "micro" ? initiateRebalance : undefined
            }
            onUseEmergencyFund={
              goalSizeTab === "macro" ? handleUseEmergencyFund : undefined
            }
            isMicroGoal={goalSizeTab === "micro"}
            isMacroGoal={goalSizeTab === "macro"}
          />
        ))}
      </div>

      {/* Rebalance Dialog */}
      <Dialog open={showRebalanceDialog} onOpenChange={setShowRebalanceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebalance Your Goals</DialogTitle>
            <DialogDescription>
              Move funds from "{sourceGoal?.title}" to another micro goal.
              Maximum amount available: ₹{maxRebalanceAmount.toFixed(2)}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount to transfer</Label>
              <Input
                id="amount"
                type="number"
                min="1"
                max={maxRebalanceAmount}
                value={rebalanceAmount}
                onChange={(e) => setRebalanceAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>

            <div className="space-y-2">
              <Label>Select goal to transfer to</Label>
              <RadioGroup value={targetGoalId} onValueChange={setTargetGoalId}>
                {filteredGoals
                  .filter((goal) => goal.id !== sourceGoal?.id)
                  // Only show other micro goals for rebalancing
                  .filter((goal) => goal.targetAmount < MICRO_GOAL_THRESHOLD)
                  .map((goal) => (
                    <div
                      key={goal.id}
                      className="flex items-center space-x-2 border p-2 rounded my-1"
                    >
                      <RadioGroupItem value={goal.id} id={goal.id} />
                      <Label htmlFor={goal.id} className="flex-1">
                        {goal.title} (Current:{" "}
                        {formatCurrency(goal.currentAmount)})
                      </Label>
                    </div>
                  ))}
              </RadioGroup>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRebalanceDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleRebalanceConfirm}>Confirm Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GoalList;
