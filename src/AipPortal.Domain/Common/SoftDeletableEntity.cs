namespace AipPortal.Domain.Common;

public abstract class SoftDeletableEntity : AuditableEntity
{
    public DateTimeOffset? DeletedAt { get; private set; }

    public bool IsDeleted => DeletedAt.HasValue;

    public void MarkDeleted(DateTimeOffset deletedAt)
    {
        DeletedAt = deletedAt;
    }
}
