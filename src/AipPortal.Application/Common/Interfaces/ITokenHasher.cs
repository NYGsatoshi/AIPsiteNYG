namespace AipPortal.Application.Common.Interfaces;

public interface ITokenHasher
{
    string HashToken(string token);
}
